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
`GET /api/stellar/payment/reconciliation/status` reports `unreconciledCount`
and `unreconciledByReason`.

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

## Indexes

| Collection | Index | Used by |
|---|---|---|
| `transactions` | `{ paymentReference: 1 }` unique, partial on `$type: "string"` | canonical lookup |
| `transactions` | `{ memo: 1, itemType: 1, status: 1, buyerWallet: 1 }` | legacy lookup |
| `transactions` | `{ stellarTxHash: 1 }` unique sparse (existing) | hash lookup |
| `unreconciledpayments` | `{ resolvedAt: 1, reasonCode: 1, createdAt: -1 }` | triage, status endpoint |

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
