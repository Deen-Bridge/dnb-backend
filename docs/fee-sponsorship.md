# Fee-Bump Sponsorship — Platform-Paid Network Fees

This document describes the optional **fee-bump sponsorship** flow (issue #30):
the platform can pay a user's Stellar network fee so a user who holds USDC but
almost no XLM can still buy a book, buy a course, or donate.

## The problem it solves

Stellar network fees are paid in XLM. A newly onboarded user typically holds
USDC but little or no XLM, so their otherwise-valid payment fails at submission
for lack of XLM. Fee sponsorship removes that onboarding wall **without touching
custody**: the platform wraps the user-signed transaction in a
[fee-bump transaction](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/fee-bump-transactions)
signed by a dedicated *fee-source* account. The user still signs — and only ever
signs — their own payment operations; the sponsor key signs **only** the
fee-bump wrapper and can never move user funds.

## Trust model & guard rails

Because the server signs on behalf of the platform, the flow is reject-by-default:

1. **Structural whitelist** (`validateInnerTransaction`). The user's inner
   transaction must match, operation-for-operation, the pending `Transaction`
   row the server already built at initialize:
   - **source** equals `buyerWallet`;
   - **exact operation set** — the operation count equals the expected count
     (1 for a direct payment/donation, 2 for a fee split) and every operation is
     a `payment` in the settlement asset. This is enforced by **allow-list**:
     only `payment` is permitted, so `changeTrust`, `setOptions`, `manageData`,
     `accountMerge`, `createAccount`, `pathPaymentStrict*`, a second unexpected
     `payment`, or any operation type not yet invented all fail;
   - **destinations, amounts, asset** match the row exactly (creator + platform
     split from `platformFee`; donations against `DONATION_WALLET_PUBLIC_KEY`),
     compared in stroops;
   - **memo** equals the row's memo.
2. **Spend caps** (`SponsorshipSpend` + `checkSpendCaps`), enforced *before*
   wrapping:
   - per-transaction fee ceiling (`FEE_SPONSOR_MAX_FEE_STROOPS`);
   - per-UTC-day total spend (`FEE_SPONSOR_DAILY_CAP_STROOPS`);
   - per-user per-UTC-day sponsored-transaction count
     (`FEE_SPONSOR_PER_USER_DAILY_LIMIT`).
3. **Sponsor float pre-check** — refuses (non-fatally) if the sponsor account
   cannot cover the declared max fee, so an underfunded float never causes a
   Stellar submit failure that would mark the user's transaction `failed`.

## Fee-bump fee semantics

The fee-bump fee is priced per operation **including** the wrapper — the total
fee is `baseFeePerOp × (innerOps + 1)` (verified against the installed
`@stellar/stellar-sdk` and asserted in tests). The service declares the highest
per-op fee the per-transaction ceiling allows, so the sponsor tolerates fee
surges up to the cap while Horizon still only charges the true network fee. The
declared total is always clamped to `FEE_SPONSOR_MAX_FEE_STROOPS`.

Two hashes are recorded for a sponsored row: Horizon returns the **fee-bump
(outer) hash** (`feeBumpTxHash`), while the **inner-transaction hash**
(`stellarTxHash`) is what matches the `expectedHash` stored at initialize and
what the on-chain payment verification (`verifyPaymentOperations`) runs against.

## API

Sponsorship is opt-in per submit — there is **no new endpoint**. Add
`requestSponsorship: true` to an existing submit request:

- `POST /api/stellar/payment/submit` — `{ transactionId, signedXdr, requestSponsorship: true }`
- `POST /api/stellar/donation/submit` — `{ donationId, signedXdr, requestSponsorship: true }`

When sponsorship is applied, the confirmed response carries `sponsored: true`,
`feeBumpTxHash`, and `sponsorFeeCharged` (the real `fee_charged` from Horizon).

### Failure semantics

Sponsorship-specific failures **never** mark the user's `Transaction` `failed`.
They return a distinct non-fatal status with `retryUnsponsored: true`, leaving
the row `pending` so the client can retry without sponsorship (the user pays
their own fee):

| Reason (`sponsorship.reason`) | Status | Meaning |
|-------------------------------|:------:|---------|
| `whitelist_rejected`          | 422    | Inner transaction did not match the row |
| `daily_cap_exceeded`          | 429    | Per-day total spend cap would be exceeded |
| `per_user_daily_limit`        | 429    | Per-user daily sponsored count reached |
| `fee_ceiling_too_low`         | 503    | Per-tx fee ceiling too low to fee-bump |
| `sponsor_underfunded`         | 503    | Sponsor float cannot cover the fee |
| `sponsor_misconfigured`       | 503    | Secret missing/invalid at request time |

Only a genuine on-network submission failure follows the existing failed-path.

With `FEE_SPONSOR_ENABLED=false` (the default), the flag is ignored entirely and
both submit paths are byte-for-byte the original unsponsored flow — sending
`requestSponsorship: true` behaves exactly as if the flag were absent.

### Ops status endpoint

`GET /api/stellar/payment/sponsorship/status` (admin-only) returns whether
sponsorship is enabled, the sponsor account's **public key** (never the secret)
and live XLM float, the configured caps, and today's spend, so the float can be
topped up before it runs dry.

## Configuration

All variables are optional; with the master switch off, a boot with none of them
set is unchanged. When `FEE_SPONSOR_ENABLED=true`, a missing or invalid
`FEE_SPONSOR_SECRET` is a **hard boot failure** (fail fast with a clear message).

| Variable | Default | Description |
|----------|---------|-------------|
| `FEE_SPONSOR_ENABLED` | `false` | Master switch |
| `FEE_SPONSOR_SECRET` | — | Dedicated `S…` fee-source secret. **MUST NOT** be the donation or platform receiving wallet. Never logged, never returned over HTTP. |
| `FEE_SPONSOR_MAX_FEE_STROOPS` | `1000000` | Per-transaction fee ceiling (0.1 XLM) |
| `FEE_SPONSOR_DAILY_CAP_STROOPS` | `100000000` | Total fee spend per UTC day (10 XLM) |
| `FEE_SPONSOR_PER_USER_DAILY_LIMIT` | `10` | Max sponsored transactions per user per UTC day |

The sponsor account should be a dedicated, low-balance account topped up only
with the XLM float it needs for fees — never the donation or platform receiving
wallet.

## Observability

Every sponsorship decision is logged (approved / rejected + reason; the secret is
never logged) and counted in Prometheus via `fee_sponsorships_approved_total`
and `fee_sponsorships_rejected_total{reason}`.

## Tests

- `test/feeSponsorService.test.js` — structural whitelist adversarial matrix,
  fee-bump fee correctness (asserted against the SDK), inner-transaction-untouched
  proof, spend caps, secret handling, and boot-config validation.
- `test/feeSponsorSubmit.test.js` — controller wiring for both the payment and
  donation submit paths: flag-off regression (byte-for-byte unchanged), flag-on
  sponsorship, and cap/whitelist rejections that never mark the row `failed`.

Run: `node --experimental-vm-modules node_modules/jest/bin/jest.js --runInBand --forceExit test/feeSponsorService.test.js test/feeSponsorSubmit.test.js`
