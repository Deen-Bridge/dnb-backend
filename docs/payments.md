# Payments and Stellar Integration

This guide explains how DeenBridge takes payments on the Stellar network, how a
payment moves from checkout to a recorded sale, and which modules, jobs and
environment variables are involved. It describes the code on `main` at the time
of writing. Where something could not be confirmed from the code it is marked
**unverified**.

Related docs: [MAINNET.md](MAINNET.md), [idempotency.md](idempotency.md),
[transaction-lifecycle.md](transaction-lifecycle.md), [webhooks.md](webhooks.md),
[fee-sponsorship.md](fee-sponsorship.md), [anchors.md](anchors.md).

## 1. Stellar integration

### Network configuration

`src/config/stellar.js` is the single source of truth for network identity.
`resolveStellarConfig()` returns the network name, network passphrase, Horizon
URLs, USDC issuer and default asset; `stellarService.js` consumes it.

| Setting | Behaviour |
|---------|-----------|
| `STELLAR_NETWORK` | `testnet` (default when unset), `mainnet`, or `public` (alias for `mainnet`). Any other value throws. |
| `HORIZON_URLS` | Comma-separated list. Defaults to the canonical Horizon for the selected network. |
| `HORIZON_TIMEOUT_MS`, `HORIZON_MAX_RETRIES`, `HORIZON_CB_THRESHOLD`, `HORIZON_CB_COOLDOWN_MS` | Tuning for the resilient Horizon client (`src/services/stellar/horizonClient.js`): timeout, retries, circuit-breaker threshold and cooldown. |
| `SOROBAN_RPC_URL` | Soroban RPC endpoint. Falls back to the public testnet endpoint on testnet; required on mainnet (per `.env.example`). |

`validateStellarConfig()` runs at boot and refuses to start if, for example, a
mainnet flag is paired with the testnet Horizon URL or a testnet USDC issuer.
Asset definitions (USDC issuer per network, XLM) live in `src/config/assets.js`.
The `Transaction` model records which `network` a row was created on
(`testnet` or `mainnet`).

### Testnet vs mainnet

Testnet is the default. Switching to mainnet changes the network passphrase,
Horizon endpoint and USDC issuer together; the full checklist (including the
frontend flag) is in [MAINNET.md](MAINNET.md). Never reuse testnet keys or
contract ids on mainnet.

### Wallets and signing model

The backend does not hold users' keys. It builds unsigned transaction XDR
(`initialize` endpoints), the user signs in their wallet, and the signed XDR is
returned to a `submit` endpoint that submits it to Horizon. Wallet linking is in
`src/routes/stellar/walletRoutes.js` and `controllers/stellar/walletController.js`
(`/api/stellar/wallet`).

Platform-side keys, all configured by environment variable (names only):

- `PLATFORM_WALLET_PUBLIC_KEY` - receiving wallet for platform-collected
  purchases; also used as the payout source (`payoutService.js`) and watched by
  the ingestion worker.
- `DONATION_WALLET_PUBLIC_KEY` - donation receiving wallet; watched by the
  ingestion worker.
- `PLATFORM_FEE_PERCENT` - platform fee split (0-20; values above 20 are
  capped). `PLATFORM_COLLECT_ENABLED` is read by the code (settlement mode
  `direct` vs `platform_collect`); its exact semantics are **unverified**.
- `FEE_SPONSOR_ENABLED`, `FEE_SPONSOR_SECRET`, `FEE_SPONSOR_MAX_FEE_STROOPS`,
  `FEE_SPONSOR_DAILY_CAP_STROOPS`, `FEE_SPONSOR_PER_USER_DAILY_LIMIT` -
  optional fee-bump sponsorship (see [fee-sponsorship.md](fee-sponsorship.md)).
  The sponsor key is a dedicated fee-only key.

### SEP flows

| SEP | What it does here | Where |
|-----|-------------------|-------|
| SEP-1 | Serves `/.well-known/stellar.toml`, built from env. | `src/routes/wellKnownRoutes.js`, `services/stellar/stellarTomlService.js` |
| SEP-10 | "Sign in with Stellar" for DeenBridge itself: `GET /api/auth/stellar/challenge`, `POST /api/auth/stellar/verify`. Feature returns 503 until configured. | `routes/authRoutes.js`, `controllers/stellar/sep10Controller.js`, `services/stellar/sep10Service.js` |
| SEP-10 (client) + SEP-24 | Acting as a client to an external anchor: fetch and validate the anchor's challenge, store the anchor JWT, start interactive deposits/withdrawals, and poll status. | `routes/stellar/anchorRoutes.js` (`/api/stellar/anchor/*`), `controllers/stellar/anchorController.js`, `services/stellar/anchorService.js`, `jobs/anchorPoller.js`, `AnchorTransaction` model |

Env names: `SEP10_SIGNING_SECRET` (dedicated auth key, never holds funds),
`SEP10_HOME_DOMAIN`, `SEP10_WEB_AUTH_DOMAIN`, `SEP10_CHALLENGE_TIMEOUT`,
`SEP10_WEB_AUTH_ENDPOINT`, `STELLAR_PLATFORM_PUBLIC_KEY`, `ANCHOR_HOME_DOMAINS`,
`ANCHOR_TOML_CACHE_TTL`, plus the `ORG_*` fields used for the toml.

A separate fiat on-ramp via MoonPay lives in `routes/stellar/onrampRoutes.js`
(`/api/stellar/onramp`); its webhook is verified with the
`Moonpay-Signature-V2` header. Env names: `MOONPAY_API_KEY`,
`MOONPAY_SECRET_KEY`, `MOONPAY_WEBHOOK_KEY`, `MOONPAY_WIDGET_URL`,
`MOONPAY_DEFAULT_CRYPTO_CODE`.

Soroban contracts (loyalty points, scholarship escrow) are reached through
`services/stellar/sorobanService.js` and `scholarshipEscrowService.js`; see
[soroban-escrow-design.md](soroban-escrow-design.md). Env names:
`SCHOLARSHIP_ESCROW_CONTRACT_ID`, `GIVING_ESCROW_CONTRACT_ID` (legacy alias),
and `LOYALTY_CONTRACT_ID` (from `.env.example`).

## 2. Payment lifecycle

```
initiate -> (user signs) -> confirm -> reconcile -> record
```

Route mounts are in `app.js`: `/api/stellar/payment` (`paymentLimiter`),
`/api/stellar/donation`, `/api/stellar/scholarships`, `/api/stellar/pledges`,
`/api/stellar/gifts`, `/api/stellar/onramp`, `/api/payouts`.

1. **Initiate** - `POST /api/stellar/payment/initialize`
   (`controllers/stellar/paymentController.js` `initializePayment`). Optional
   helpers: `/quote` and `/preflight`. Creates a `Transaction` with status
   `pending` and an `expiresAt` 30 minutes out, and returns unsigned XDR.
   Donations use `/api/stellar/donation/initialize`
   (`donationController.js`, `donationIntentService.js`).
2. **Confirm** - `POST /api/stellar/payment/submit` (`submitPayment`). Submits
   the signed XDR, then verifies the on-chain operations against what was
   expected (`verifyPaymentOperations` in `stellarService.js`). Statuses used:
   `pending`, `submitted`, `retrying`, `confirmed`, `failed`, `expired`,
   `refunded`, `disputed` (see `models/Transaction.js`). If verification is
   transiently unavailable the transaction goes to `retrying` and the
   `verifyPaymentOnChain` job (`src/jobs/handlers.js`, queue in
   `src/jobs/queue.js`) retries it until it is `confirmed` or `failed`.
3. **Reconcile** - a safety net for payments that reach the platform wallets
   without a clean confirm call. The ingestion worker (section 5) feeds Horizon
   payments to `reconcilePayment` in
   `services/stellar/reconciliationService.js`, which matches by transaction
   hash, then by memo, and otherwise records an `UnreconciledPayment` for
   manual review. `GET /api/stellar/payment/reconciliation/status` (admin)
   reports cursors and counts.
4. **Record** - on confirmation, the buyer gets access (`grantItemAccess` in
   the reconciliation service; direct purchase update in the controller/job),
   donation pledges are marked paid, a receipt is queued, and for purchases
   `recordSaleEarnings` (`services/payoutService.js`) credits the educator's
   ledger. Outbound webhook events (`payment.confirmed`, etc.) are emitted
   after commit (section 5).

Confirmed purchases and donations are never TTL-reaped; see
[transaction-lifecycle.md](transaction-lifecycle.md).

Refunds and disputes (`/transactions/:id/refund-request`, `/refunds/:refundId/{build,submit,reject,dispute,arbitrate}`)
use the `Refund` model and `refundController.js`. Scholarship, pledge and gift
flows follow the same initialize/submit pattern in their own route files under
`src/routes/stellar/`.

## 3. Idempotency (current `main`)

`src/middlewares/idempotency.js` exports `idempotency({ required = false })`.
It reads `Idempotency-Key` (or `X-Idempotency-Key`), requires an authenticated
user when a key is sent, and stores an `IdempotencyKey` record scoped to
`{ key, userId, endpoint }` with a SHA-256 hash of the request body:

- same key and body, still running: `409`
- same key, different body: `422`
- same key and body after completion: the stored status and JSON body are
  replayed without re-running the handler
- `5xx` responses (and aborted requests) delete the key so the client can retry
- records expire after 24 hours (TTL index; see `models/IdempotencyKey.js`)

With the default `required: false`, requests without a key pass through
unprotected. No route currently passes `required: true`.

Routes using `idempotency()` on `main` (checked by grep of `src/routes`):

- `paymentRoutes.js`: `initialize`, `submit`, `DELETE /transactions/:transactionId`,
  refund request/build/submit/reject/dispute, and `refunds/:refundId/arbitrate`
- `donationRoutes.js`: `initialize`, `submit`
- `payoutRoutes.js`: `build`, `:batchId/submit`
- `pledgeRoutes.js`, `giftRoutes.js`, `scholarshipRoutes.js`: the mutating
  POST/PATCH endpoints listed there

Upstream PR #497 is reported to extend this to more routes; that is not
described here. [idempotency.md](idempotency.md) lists a narrower set of
endpoints than the code now wires up. Idempotency is also enforced at the data
level: `recordSaleEarnings` skips a transaction that already has a `sale`
`LedgerEntry` for the same `txRef`, and ingestion upserts
`UnreconciledPayment` by transaction hash.

## 4. Payouts and payout audit

Educator earnings are tracked in `EducatorBalance` and an append-style
`LedgerEntry` (`sale` or `payout`). Payouts are an operator-driven batch flow,
code in `src/routes/payoutRoutes.js`, `controllers/payoutController.js` and
`services/payoutService.js`:

- Educators (authenticated): `GET /api/payouts/me/balance`, `/me/statement`,
  `/me/history`.
- Operators: `POST /api/payouts/build` (supports `dryRun`; creates a
  `PayoutBatch` with unsigned XDR chunks, up to 100 recipients per chunk) and
  `POST /api/payouts/:batchId/submit` (takes the signed XDRs, submits and
  verifies each chunk). Both are gated by the `PAYOUT_ADMIN_USER_IDS`
  allowlist inside the controller and wrapped in `idempotency()`.
- Batch statuses: `built`, `submitted`, `confirmed`, `failed`; `failed` and
  `built` batches can be resubmitted.

Audit:

- `recalculateBalancesFromLedger()` rebuilds balances from the ledger and
  reports differences; `src/scripts/auditPayouts.js` runs it.
- `models/AuditLog.js` defines `payout.batch.initiated` and
  `payout.batch.confirmed` actions and states financial audit rows are kept
  indefinitely (no TTL). In the code searched, `recordAudit` is not called from
  `payoutController.js` or `payoutService.js`, so whether those events are
  currently written is **unverified**; the enum entries exist.

## 5. Webhooks, reconciliation jobs and workers

### Outbound webhooks (`src/services/webhooks/`)

- Admin-only management API at `/api/webhooks` (`routes/webhookRoutes.js`,
  `controllers/webhookController.js`): CRUD, rotate secret, list deliveries,
  redeliver, ping.
- `webhookService.js`: event catalog (`payment.initialized`,
  `payment.confirmed`, `payment.failed`, `payment.expired`, `course.enrolled`,
  `wallet.connected`, `wallet.disconnected`, `ping`). `emitEvent` never throws
  into the request path and strips `data` to an allowlist of fields (no emails
  or secrets).
- `signing.js`: HMAC-SHA256 over `` `${timestamp}.${rawBody}` ``, sent as
  `X-DeenBridge-Signature: v1=<hex>` with `X-DeenBridge-Event`,
  `X-DeenBridge-Event-Id` and `X-DeenBridge-Timestamp`. Default replay
  tolerance for consumers is 5 minutes. Details for consumers are in
  [webhooks.md](webhooks.md).
- `webhookSecret.js`: per-endpoint secrets are stored encrypted (AES-256-GCM)
  with a key derived from `WEBHOOK_SECRET_ENCRYPTION_KEY` (required in
  production).
- `urlGuard.js`: SSRF protection. Endpoints must be https (http only when
  `NODE_ENV=development`), `localhost` and private, loopback, link-local, CGNAT
  and multicast addresses are rejected, including IPv4-mapped IPv6. Checked at
  registration and again at delivery, where production also resolves DNS and
  rejects if any address is private. Known gap, documented in the file: DNS
  rebinding between resolution and connect (TOCTOU) is not closed.
- `deliveryWorker.js`: polls for `pending`/`retrying` deliveries, claims them
  atomically, retries with a backoff schedule (1m, 5m, 30m, 2h, 12h plus
  jitter), marks a delivery `dead` after `WEBHOOK_MAX_ATTEMPTS`, and
  auto-disables an endpoint after repeated dead deliveries. Started from
  `server.js` when `WEBHOOK_WORKER_ENABLED=true`.

Env names: `WEBHOOK_SECRET_ENCRYPTION_KEY`, `WEBHOOK_WORKER_ENABLED`,
`WEBHOOK_POLL_INTERVAL_MS`, `WEBHOOK_MAX_ATTEMPTS`,
`WEBHOOK_AUTO_DISABLE_THRESHOLD`, `WEBHOOK_BACKOFF_JITTER_MS`,
`WEBHOOK_HTTP_TIMEOUT_MS`, `WEBHOOK_API_VERSION`, `WEBHOOK_MAX_PER_TICK`.

### Payment ingestion worker (reconciliation)

`src/workers/paymentIngestionWorker.js` polls Horizon `payments` for each
account in `PLATFORM_WALLET_PUBLIC_KEY` and `DONATION_WALLET_PUBLIC_KEY`
(oldest first, 200 per page), keeps only USDC payments from the configured
issuer (including path payments delivering USDC), loads the parent transaction
for its memo and source, and calls `reconcilePayment`. The per-account cursor
is stored in `IngestionCursor`, so restarts resume where they left off.

It runs either inside the API process (`INGESTION_WORKER_ENABLED=true` in
`server.js`) or as its own process via `src/workers/runIngestionWorker.js`.
Poll interval: `INGESTION_POLL_INTERVAL_MS` (default 30000). If neither wallet
variable is set the loop logs a warning and exits. It only handles USDC; other
registry assets are not ingested (**unverified** whether that is intentional).

### Other background jobs

- `verifyPaymentOnChain` (`src/jobs/handlers.js`) - retrying confirmation;
  queue controlled by `QUEUE_DRIVER` and `JOBS_ENABLED`.
- `src/jobs/anchorPoller.js` - polls SEP-24 anchor transactions with backoff.
- `src/workers/pledgeScheduler.js` - recurring pledge cycles
  (`PLEDGE_SCHEDULER_ENABLED`, `PLEDGE_SCHEDULER_INTERVAL_MS`,
  `PLEDGE_PAYMENT_WINDOW_MS`).

## 6. Environment and secrets reference

Names only; see `.env.example` for placeholders. Treat everything marked secret
as a secret: keep it out of git, logs and chat, and use your deployment's secret
store.

| Area | Variables | Secret? |
|------|-----------|---------|
| Network | `STELLAR_NETWORK`, `HORIZON_URLS`, `HORIZON_TIMEOUT_MS`, `HORIZON_MAX_RETRIES`, `HORIZON_CB_THRESHOLD`, `HORIZON_CB_COOLDOWN_MS`, `SOROBAN_RPC_URL` | no |
| Wallets | `PLATFORM_WALLET_PUBLIC_KEY`, `DONATION_WALLET_PUBLIC_KEY`, `STELLAR_PLATFORM_PUBLIC_KEY`, `PLATFORM_FEE_PERCENT`, `PLATFORM_COLLECT_ENABLED` | no (public keys) |
| Fee sponsorship | `FEE_SPONSOR_ENABLED`, `FEE_SPONSOR_MAX_FEE_STROOPS`, `FEE_SPONSOR_DAILY_CAP_STROOPS`, `FEE_SPONSOR_PER_USER_DAILY_LIMIT` | no |
| | `FEE_SPONSOR_SECRET` | **yes** |
| SEP-10 / anchors | `SEP10_HOME_DOMAIN`, `SEP10_WEB_AUTH_DOMAIN`, `SEP10_CHALLENGE_TIMEOUT`, `SEP10_WEB_AUTH_ENDPOINT`, `ANCHOR_HOME_DOMAINS`, `ANCHOR_TOML_CACHE_TTL` | no |
| | `SEP10_SIGNING_SECRET` | **yes** |
| Contracts | `SCHOLARSHIP_ESCROW_CONTRACT_ID`, `GIVING_ESCROW_CONTRACT_ID` | no |
| On-ramp | `MOONPAY_WIDGET_URL`, `MOONPAY_DEFAULT_CRYPTO_CODE` | no |
| | `MOONPAY_API_KEY`, `MOONPAY_SECRET_KEY`, `MOONPAY_WEBHOOK_KEY` | **yes** |
| Payouts | `PAYOUT_ADMIN_USER_IDS` (operator allowlist of user ids) | sensitive config |
| Refunds | `REFUND_WINDOW_DAYS` | no |
| Webhooks | `WEBHOOK_WORKER_ENABLED`, `WEBHOOK_POLL_INTERVAL_MS`, `WEBHOOK_MAX_ATTEMPTS`, `WEBHOOK_AUTO_DISABLE_THRESHOLD`, `WEBHOOK_BACKOFF_JITTER_MS`, `WEBHOOK_HTTP_TIMEOUT_MS`, `WEBHOOK_API_VERSION`, `WEBHOOK_MAX_PER_TICK` | no |
| | `WEBHOOK_SECRET_ENCRYPTION_KEY` | **yes** |
| Workers | `INGESTION_WORKER_ENABLED`, `INGESTION_POLL_INTERVAL_MS`, `PLEDGE_SCHEDULER_ENABLED`, `QUEUE_DRIVER`, `JOBS_ENABLED` | no |

The donation fund and platform wallet entries are public keys only. Signing keys
for those wallets are never configured in the backend; payout and refund
transactions are built unsigned and signed by an operator.
