# Payment reconciliation contract

Issue #695. This page covers how the ingestion worker matches an on-chain USDC
payment to a checkout, what it refuses to match, and how existing memos are
migrated.

Code: `src/services/stellar/paymentReference.js` (reference format) and
`src/services/stellar/reconciliationService.js` (resolution and settlement).

## Why it changed

Purchase memos used to be `DNB-BOOK-<last 8 hex chars of the item id>`. To
resolve one, reconciliation loaded every open checkout of that item type and,
if none matched, every book or course in the catalog, then returned the first
item whose id ended in those 8 characters. That had three problems:

- **Collisions.** Eight hex characters are not a unique identifier. Two items
  with the same suffix made the match depend on whichever row came first.
- **Unbounded work.** One Horizon event could read the whole pending set and
  the whole catalog, and a worker retry would do it again.
- **Weak checks.** The catalog fallback created a confirmed purchase without
  checking the destination wallet, and accepted any amount at or above the
  price.

## Canonical payment reference

`initializePayment` generates a random reference for each checkout, stores it
in `Transaction.paymentReference`, and puts it in the text memo:

| Memo | Meaning |
|---|---|
| `DNB-B-<ref>` | book purchase |
| `DNB-C-<ref>` | course purchase |
| `DNB-SADAQAH` | donation (unchanged) |

`<ref>` is 22 Crockford base32 characters (`0-9A-Z` without `I L O U`), which
is 110 random bits. The full memo is exactly 28 bytes, the Stellar text memo
limit. References are case-sensitive. A unique partial index on
`paymentReference` makes a collision fail the insert, so it can never cause a
wrong match. Initialize also retries reference generation up to three times
before saving.

The memo includes the item type so reconciliation can check it against the
checkout (`item_type_mismatch`). The reference alone identifies the checkout.

## Resolution order

For each USDC payment from the configured issuer:

1. **By transaction hash.** If a `Transaction` already has this
   `stellarTxHash`, use it. This covers rows from the submit flow and
   duplicate events.
2. **By memo.** Only `memo_type: "text"` memos are read.
   - Canonical memo: look up `{ paymentReference: { $eq, $type: "string" } }`.
   - Legacy memo: look up
     `{ memo, itemType, status ∈ open, buyerWallet: payer }`.
   - Donation memo: the donation flow. The payment must go to
     `DONATION_WALLET_PUBLIC_KEY` and come from a known user.
   - Anything else: `no_reference`.

Sponsored checkouts store the inner hash in `stellarTxHash` and the fee-bump
hash in `feeBumpTxHash`. A payment reported under either hash counts as the
same payment, and the inner hash stays the recorded one.

Every lookup is an exact match on an index, limited to 2 rows, and bounded by
`maxTimeMS` (`RECONCILIATION_QUERY_TIMEOUT_MS`, default 2000). Two rows are
enough to tell "exactly one" from "ambiguous". The catalog is only queried by
the `itemId` on the matched checkout, never scanned.

## Checks before a checkout is promoted

Every check must pass before anything is written:

| Check | Reason code on failure |
|---|---|
| Checkout is `pending`, `submitted` or `retrying` | `transaction_not_reconcilable` |
| Checkout has no tx hash yet, or has this one | `reference_hash_mismatch` |
| `transaction.network` is the configured network | `network_mismatch` |
| Asset code and issuer match the checkout | `asset_mismatch` |
| Transaction source and operation source are the buyer wallet | `source_mismatch` |
| Payment destination is one of the checkout's expected legs | `destination_mismatch` |
| Amount exactly matches that leg (creator or platform-fee) | `amount_mismatch` |
| `itemType`/`itemTypeModel` agree and the item still exists | `item_type_mismatch` / `item_not_found` |
| `verifyPaymentOperations` confirms every expected leg on-chain | `verification_failed` / `verification_unavailable` |

Promotion is a compare-and-set:
`findOneAndUpdate({ _id, status ∈ open, stellarTxHash ∈ [null, hash] })`.
If two workers, or a worker and the submit flow, race on one checkout, only one
of them confirms it.

## Idempotency

- **Duplicate events.** The hash lookup finds the confirmed row and returns
  `duplicate` without writing anything.
- **Concurrent workers.** The compare-and-set picks one winner. The others get
  `duplicate`.
- **Crash after confirmation.** The worker marks rows it confirms with
  `reconciledAt`. If an event for such a row is replayed more than 60 seconds
  later, the worker runs `recordSaleEarnings` and `grantItemAccess` again. Both
  are idempotent: earnings are keyed by tx hash, and access is not re-pushed
  for an item the buyer already owns. Refunded or disputed rows are never
  re-granted.
- **Unreconciled replays.** The `UnreconciledPayment` row is upserted by hash.
  `attempts` and `lastSeenAt` go up and no new row is created. When a later
  replay settles the payment, the row gets `resolvedAt`.
- **Lookup failure or timeout.** The payment is saved as `lookup_failed`
  instead of being dropped when the worker cursor moves past it.

## Triage: reason codes

Unresolved rows: `UnreconciledPayment.find({ resolvedAt: null })`.
`GET /api/stellar/payment/reconciliation/status` reports the open count per
reason in `backlog.byReason` (see [Health status and
runbook](#health-status-and-runbook)).

| Code | What to do |
|---|---|
| `no_reference` | Payment had no DeenBridge memo. Contact the sender or refund. |
| `malformed_reference` | Memo uses a DNB prefix but is not valid (typo or tampering). Match manually. |
| `reference_not_found` | No checkout has this reference, or a legacy memo has no open checkout for the payer (the checkout may have been TTL-reaped). Find the item and grant access manually. |
| `ambiguous_reference` | More than one candidate. For legacy memos, choose the payer's intended checkout. For canonical memos, check that the unique index exists. |
| `item_type_mismatch` | Memo item type differs from the checkout. Treat as suspicious. |
| `item_not_found` | Item was deleted after checkout. Refund or substitute. |
| `reference_already_settled` | Second payment against a settled reference. Likely a double payment, so refund. |
| `reference_hash_mismatch` | Checkout is tied to a different submitted transaction. Check both hashes. |
| `transaction_not_reconcilable` | Checkout is `failed`/`expired`. Confirm on-chain, then promote manually. |
| `network_mismatch`, `asset_mismatch` | Configuration or tampering. Do not promote. |
| `source_mismatch`, `destination_mismatch`, `amount_mismatch` | Payment does not match the checkout. Do not promote. Refund if appropriate. |
| `verification_failed` | Horizon operations disagree with the checkout. Do not promote. |
| `verification_unavailable` | Horizon was unavailable. Safe to replay. |
| `unknown_donor` | Donation from a wallet no user has linked. |
| `lookup_failed` | Database timeout or error. Safe to replay. |

Logs include the tx hash, reason code and reference kind. They do not include
memos or wallet addresses; those are stored on the row for triage.

## Metrics

| Metric | Labels |
|---|---|
| `payment_reconciliation_lookup_duration_seconds` | `strategy` (`tx_hash`, `canonical`, `legacy`, `donation`, `none`), `outcome` (`matched`, `rejected`, `ambiguous`, `not_found`, `error`) |
| `payment_reconciliation_ambiguous_references_total` | `scheme` (`canonical`, `legacy`) |
| `payment_reconciliation_rejected_references_total` | `reason` |
| `payment_reconciliation_unreconciled_total` | `reason` |

Every label comes from a fixed list, so memo content cannot create new series.
Alert on any non-zero `ambiguous_references_total{scheme="canonical"}`, which
means the unique index is missing.

Health gauges (#696) are listed under [Metrics and
alerts](#metrics-and-alerts).

## Indexes

| Collection | Index | Used by |
|---|---|---|
| `transactions` | `{ paymentReference: 1 }` unique, partial on `$type: "string"` | canonical lookup |
| `transactions` | `{ memo: 1, itemType: 1, status: 1, buyerWallet: 1 }` | legacy lookup |
| `transactions` | `{ stellarTxHash: 1 }` unique sparse (existing) | hash lookup |
| `transactions` | `{ reconciledAt: 1 }` sparse | status endpoint: worker confirmations per window |
| `unreconciledpayments` | `{ resolvedAt: 1, reasonCode: 1, createdAt: -1 }` | triage, status endpoint (by reason, resolved per window) |
| `unreconciledpayments` | `{ resolvedAt: 1, createdAt: 1 }` | status endpoint: age buckets, oldest-first sample |
| `unreconciledpayments` | `{ createdAt: 1 }` | status endpoint: arrivals per window |

The partial index is only used when the query repeats its filter, so the
canonical lookup includes `$type: "string"`.

## Migration plan for existing memos

No data is rewritten. A legacy memo is already inside a signed transaction, so
changing the stored value would only break the match.

1. **Build indexes before deploying the worker.** Run
   `npm run migrate:payment-references` (idempotent). It creates the indexes
   above and logs how many open checkouts still have legacy memos. Deployments
   with Mongoose `autoIndex` on build them at startup anyway. Run the script
   during a low-traffic window either way.
2. **Deploy.** New checkouts get canonical memos straight away. Open legacy
   checkouts still settle through the exact-memo lookup scoped to the payer.
   If they collide, they are saved as `ambiguous_reference` and nothing is
   chosen.
3. **Drain.** Pending legacy checkouts expire after 30 minutes. Submitted and
   retrying ones already have `stellarTxHash` and resolve by hash. Re-run the
   migration script until it reports `0` open legacy checkouts.
4. **Behaviour change.** A legacy memo with no open checkout no longer creates
   a purchase from the catalog. It is saved as `reference_not_found` for manual
   review.

Gift memos (`DNB-GIFT-…`) and payout memos are not reconciled by this worker
and are unchanged.

## Health status and runbook

Issue #696. `GET /api/stellar/payment/reconciliation/status` tells on-call
staff whether ingestion is keeping up and how much settlement risk is
waiting, from one response.

Code: `src/services/stellar/reconciliationHealthService.js` (DTO, thresholds),
`src/workers/paymentIngestionWorker.js` (writes the health fields).

### Authorization and data exposure

- Requires a logged-in user with role `admin` and TOTP 2FA enabled
  (`protect` + `authorizeRoles("admin")`). Other roles get `403`.
- The response is a fixed DTO (`version: 1`), not stored documents. Changing
  `IngestionCursor` or `UnreconciledPayment` does not change the response.
  A breaking change to the DTO bumps `version`.
- Wallet addresses are truncated (`GABC…WXYZ`) and transaction hashes are
  truncated (`3f9a1c…7be2`). Memos, amounts, sender accounts, raw cursors,
  worker host names and error messages are never returned. Full records stay
  in the database for triage by staff with database access.
- Every list is bounded: at most two watched accounts, a backlog sample of at
  most 5 rows (oldest first), and reason counts keyed by a fixed enum.
  Cursors for accounts that are no longer watched are only counted
  (`unwatchedCursorCount`).
- Responses carry `Cache-Control: no-store`.
- `200` is returned whatever the state; this is a report, not a probe. `503`
  means the status could not be computed. Treat that as `unknown`.

### Response

```json
{
  "success": true,
  "reconciliation": {
    "version": 1,
    "generatedAt": "2026-11-21T12:00:00.000Z",
    "state": "degraded",
    "reasons": ["cursor_stale", "worker_failing"],
    "thresholds": { "cursorStaleAfterSeconds": 300, "cursorStalledAfterSeconds": 1800, "workerFailureThreshold": 3,
                    "backlogMaxAgeSeconds": 86400, "backlogCountThreshold": 50, "backlogGrowthPerHour": 10 },
    "ingestion": {
      "pollIntervalSeconds": 30,
      "leaseSeconds": 120,
      "unwatchedCursorCount": 0,
      "accounts": [
        { "role": "platform", "account": "GABC…WXYZ", "state": "stale",
          "lastPollAt": "2026-11-21T11:59:50.000Z", "lastSuccessAt": "2026-11-21T11:50:00.000Z",
          "secondsSinceLastSuccess": 600, "consecutiveFailures": 20,
          "lastError": { "code": "horizon_unavailable", "at": "2026-11-21T11:59:50.000Z" },
          "worker": { "state": "active", "heartbeatAt": "2026-11-21T11:59:50.000Z",
                      "leaseExpiresAt": "2026-11-21T12:01:50.000Z" } }
      ]
    },
    "backlog": {
      "unreconciledCount": 3,
      "byAge": { "under1h": 1, "from1hTo24h": 2, "from24hTo7d": 0, "over7d": 0 },
      "oldestAgeSeconds": 7300,
      "byReason": { "reference_not_found": 2, "verification_unavailable": 1 },
      "sampleLimit": 5,
      "sample": [
        { "txHash": "3f9a1c…7be2", "reasonCode": "reference_not_found", "referenceKind": "canonical",
          "attempts": 2, "firstSeenAt": "2026-11-21T09:58:20.000Z", "lastSeenAt": "2026-11-21T11:00:00.000Z",
          "ageSeconds": 7300 }
      ]
    },
    "throughput": {
      "lastHour": { "windowSeconds": 3600, "unreconciledArrived": 1, "unreconciledResolved": 0,
                    "confirmedByWorker": 14, "netBacklogChange": 1 },
      "last24h": { "windowSeconds": 86400, "unreconciledArrived": 3, "unreconciledResolved": 0,
                   "confirmedByWorker": 212, "netBacklogChange": 3 }
    },
    "runbook": "https://github.com/Deen-Bridge/dnb-backend/blob/main/docs/payment-reconciliation.md#health-status-and-runbook"
  }
}
```

### Freshness semantics

The worker writes these fields on each account's `IngestionCursor` every poll:

| Field | Written when |
|---|---|
| `lastPollAt`, `workerId`, `leaseExpiresAt` | every poll, success or failure (heartbeat) |
| `lastSuccessAt` (and legacy `lastSyncAt`) | Horizon answered and the page was processed |
| `consecutiveFailures` | `+1` on a failed poll, reset to `0` on success |
| `lastErrorAt`, `lastErrorCode` | a failed poll, or a page where at least one payment threw while reconciling |

- **Last successful poll** is `lastSuccessAt`. Rows written before #696 fall
  back to `lastSyncAt`. A cursor that has never succeeded is aged from its
  creation time.
- **Worker lease** is advisory. It is renewed on every poll and expires after
  `max(4 × INGESTION_POLL_INTERVAL_MS, 2 min)`. It does not stop two workers
  from polling the same account, since settlement is already compare-and-set.
  `active` means a worker polled recently. `expired` means no worker has
  polled within the lease. `unknown` means no lease was ever written (no
  cursor yet, or a pre-#696 worker).
- **Error codes** (`lastError.code`): `horizon_rate_limited` (429),
  `horizon_unavailable` (5xx, timeouts, connection errors), `horizon_error`
  (other Horizon errors), `reconcile_failed` (a payment threw; the cursor still
  advanced), `persistence_error` (a database error during the poll), or
  `unclassified`. Full error text is only in the worker logs.
- A worker that hits a database error now logs it, records
  `persistence_error` where it can, and keeps polling. Before #696 the loop
  stopped silently.

### States and thresholds

Per account (`ingestion.accounts[].state`), checked in this order:

| State | Condition |
|---|---|
| `missing` | the account is configured but has no cursor (the worker never polled it) |
| `stalled` | no success for more than `cursorStalledAfterSeconds` |
| `stale` | no success for more than `cursorStaleAfterSeconds` |
| `failing` | recent success, but `consecutiveFailures ≥ workerFailureThreshold` |
| `fresh` | everything else |

Overall `state` is the worst of these signals. `reasons` lists every one that
applied:

| Reason | Overall state |
|---|---|
| `no_watched_accounts` (neither wallet variable set) | `stalled` |
| `cursor_missing`, `cursor_stalled` | `stalled` |
| `cursor_stale` | `degraded` |
| `worker_failing` (`consecutiveFailures ≥ workerFailureThreshold`) | `degraded` |
| `worker_lease_expired` | `degraded` |
| `backlog_aged` (`oldestAgeSeconds > backlogMaxAgeSeconds`) | `degraded` |
| `backlog_large` (`unreconciledCount ≥ backlogCountThreshold`) | `degraded` |
| `backlog_growing` (`throughput.lastHour.netBacklogChange ≥ backlogGrowthPerHour`) | `degraded` |

Backlog problems only ever degrade the state. Payments are still being
ingested, so settlement is not stalled.

| Threshold | Env variable | Default |
|---|---|---|
| `cursorStaleAfterSeconds` | `RECONCILIATION_CURSOR_STALE_SECONDS` | `300` (10 polls) |
| `cursorStalledAfterSeconds` | `RECONCILIATION_CURSOR_STALLED_SECONDS` | `1800` |
| `workerFailureThreshold` | `RECONCILIATION_WORKER_FAILURE_THRESHOLD` | `3` |
| `backlogMaxAgeSeconds` | `RECONCILIATION_BACKLOG_MAX_AGE_SECONDS` | `86400` |
| `backlogCountThreshold` | `RECONCILIATION_BACKLOG_COUNT_THRESHOLD` | `50` |
| `backlogGrowthPerHour` | `RECONCILIATION_BACKLOG_GROWTH_PER_HOUR` | `10` |

Values must be positive integers. Anything else falls back to the default.
The stalled threshold is raised to the stale threshold if it is configured
lower. The active values are echoed in `thresholds`, so dashboards should read
them from there rather than hard-coding them. The endpoint reads the same
`PLATFORM_WALLET_PUBLIC_KEY`, `DONATION_WALLET_PUBLIC_KEY` and
`INGESTION_POLL_INTERVAL_MS` as the worker. Keep them identical in the API and
worker deployments.

Backlog age is measured from when the payment was first seen
(`UnreconciledPayment.createdAt`). Buckets: `under1h`, `from1hTo24h`,
`from24hTo7d`, `over7d`. `netBacklogChange` is arrivals minus resolutions in
the window.

All status queries use the indexes above and are capped by
`RECONCILIATION_QUERY_TIMEOUT_MS` (default 2000 ms).

### Metrics and alerts

The API refreshes these gauges when Prometheus scrapes `/metrics`. Results
are cached for 15 seconds and every endpoint call refreshes them too. Labels
are roles, never wallet addresses.

| Metric | Labels | Meaning |
|---|---|---|
| `payment_reconciliation_health_state` | `state` (`healthy`, `degraded`, `stalled`, `unknown`) | `1` for the current state. `unknown` means the status could not be computed. |
| `payment_ingestion_cursor_state` | `role`, `state` | `1` for each account's current state |
| `payment_ingestion_cursor_lag_seconds` | `role` | seconds since the last successful poll |
| `payment_ingestion_consecutive_failures` | `role` | current failure streak |
| `payment_reconciliation_backlog` | `age_bucket` | open unreconciled rows per age bucket |
| `payment_reconciliation_backlog_oldest_age_seconds` | none | oldest open row (`0` when empty) |
| `payment_ingestion_polls_total` | `role`, `outcome` (`success`, `partial`, `failed`) | counter, only exported when the worker runs inside the API process (`INGESTION_WORKER_ENABLED=true`) |

Suggested alerts. They reuse the endpoint's state machine, so they follow the
configured thresholds:

```yaml
groups:
  - name: dnb-backend-payment-reconciliation
    rules:
      - alert: PaymentIngestionStalled
        expr: payment_reconciliation_health_state{state="stalled"} == 1
        for: 5m
        labels: { severity: critical }
        annotations:
          summary: "Payment ingestion is stalled; on-chain payments are not being settled"
          runbook_url: "https://github.com/Deen-Bridge/dnb-backend/blob/main/docs/payment-reconciliation.md#health-status-and-runbook"
      - alert: PaymentIngestionCursorStale
        expr: max by (role) (payment_ingestion_cursor_state{state=~"stale|stalled|missing"}) == 1
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Ingestion cursor for {{ $labels.role }} wallet is stale"
      - alert: PaymentIngestionRepeatedErrors
        expr: payment_ingestion_consecutive_failures >= 3
        for: 5m
        labels: { severity: warning }
        annotations:
          summary: "Ingestion worker keeps failing for {{ $labels.role }} wallet"
      - alert: PaymentReconciliationBacklogGrowing
        expr: delta(sum(payment_reconciliation_backlog)[1h:]) >= 10
        labels: { severity: warning }
        annotations:
          summary: "Unreconciled payment backlog grew by 10+ in the last hour"
      - alert: PaymentReconciliationBacklogAged
        expr: payment_reconciliation_backlog_oldest_age_seconds > 86400
        for: 15m
        labels: { severity: warning }
        annotations:
          summary: "An unreconciled payment has waited more than 24h for triage"
      - alert: PaymentReconciliationStatusUnknown
        expr: payment_reconciliation_health_state{state="unknown"} == 1
        for: 10m
        labels: { severity: warning }
        annotations:
          summary: "Reconciliation health cannot be computed (database unavailable?)"
```

### Runbook

| Signal | Likely cause | What to do |
|---|---|---|
| `no_watched_accounts` | Wallet variables missing in the API (and probably the worker) | Set `PLATFORM_WALLET_PUBLIC_KEY` / `DONATION_WALLET_PUBLIC_KEY` and restart. |
| `cursor_missing` | Worker never started, or the worker and API use different wallet variables | Check that `npm run worker:ingest` (or `INGESTION_WORKER_ENABLED=true`) is running and that its env matches the API. |
| `cursor_stalled` + `worker_lease_expired` | Worker process is down or hung | Restart the worker. It resumes from the stored cursor, and replays are idempotent. |
| `cursor_stale` / `worker_failing` with an `active` lease | Worker is alive but polls fail | Read `lastError.code`. For `horizon_rate_limited` or `horizon_unavailable`, check Horizon status and `HORIZON_URLS` failover. For `persistence_error`, check MongoDB. Then check the worker logs. |
| `lastError.code = reconcile_failed` | A payment threw while reconciling and the cursor moved past it | Find the tx hash in the worker logs ("Error processing payment record") and replay it. Payments that fail a lookup are already persisted as `lookup_failed`. |
| `backlog_growing` | New payments are failing to match faster than they are triaged | Group by `backlog.byReason`. A spike in one reason (e.g. `verification_unavailable`) usually has one upstream cause. |
| `backlog_aged` / `backlog_large` | Triage is behind | Work through the rows oldest first using the reason-code table above. |
| `503` / `state="unknown"` | MongoDB unreachable or status queries timing out | Check database health. The ingestion worker may still be running. |

## Tests

- `test/paymentReference.test.js`: reference format, the 28-byte limit
  (checked with the Stellar SDK), parsing, malformed and legacy memos.
- `test/reconciliation.test.js`: canonical, legacy and donation resolution,
  suffix collisions, wrong item types, no match, each validation failure,
  duplicate and concurrent events, crash recovery, timeouts, metrics.
- `test/reconciliationScale.test.js`: `explain("executionStats")` checks that
  each lookup is an `IXSCAN` with the same document count when open checkouts
  grow from 600 to 6,000 and the catalog from 400 to 4,000 (a quarter of it
  sharing one suffix). Settling a payment never queries the catalog.
- `test/reconciliationHealth.test.js`: fresh, stale, stalled, missing,
  failing and partially failed cursor states; legacy cursors; backlog age
  buckets, rates and thresholds; the fixed DTO key set; redaction and the
  5-row sample bound; index use; Prometheus gauges; the controller envelope
  and the 503 path.
- `test/jobsWorkers.test.js`: the worker's heartbeat, lease, failure streak,
  error classification and recovery after a database error.
