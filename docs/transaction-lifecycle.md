# Transaction Expiry Lifecycle and TTL Invariant

This document describes the `expiresAt` / TTL behavior of the `Transaction`
collection and the invariant that protects confirmed purchases and donations
from being deleted.

## The problem this invariant solves

`Transaction` rows are created when a buyer starts a checkout. To garbage-collect
abandoned checkouts, the collection used a blanket TTL index on `expiresAt`
(`expireAfterSeconds: 0`) with a schema default of `now + 30 minutes` applied to
**every** row — including rows that later became `confirmed`. A confirmed on-chain
purchase or donation was therefore permanently deleted ~30 minutes after it was
created: the proof that the buyer paid and the educator earned silently vanished.

## The invariant

> **`expiresAt` is only ever set on `pending` transactions. Every terminal state
> MUST clear it, the schema enforces this on save, and the TTL index is scoped
> strictly to `status: "pending"` so the reaper cannot match anything else.**

### Status → `expiresAt` mapping

| Status      | `expiresAt`      | Rationale                                                          |
|-------------|------------------|--------------------------------------------------------------------|
| `pending`   | `Date` (now + 30m) | Abandoned checkout awaiting wallet signature / submission. Eligible for TTL reaping. |
| `submitted` | retained          | In-flight on the Stellar network. Transient, non-terminal.         |
| `retrying`  | retained          | In-flight async on-chain verification. Transient, non-terminal.    |
| `confirmed` | unset             | Settled on-chain — item access granted / donation recorded. **Must never be reaped.** |
| `failed`    | unset             | Permanent failure. Kept for audit and reconciliation.              |
| `expired`   | unset             | Cancelled by the user or explicitly timed out. Kept for audit.     |
| `refunded`  | unset             | Refund executed on-chain. Kept for audit.                          |
| `disputed`  | unset             | Under administrator review. Kept for audit.                        |

## Defense in depth

The guarantee is enforced at three independent layers, so no single future code
path can regress confirmed rows back into the reaper's window:

1. **Partial TTL index (structural).** `src/models/Transaction.js` declares
   `transactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { status: "pending" } })`.
   MongoDB's TTL monitor only considers documents that match the partial filter,
   so a non-`pending` document is never a deletion candidate even if it somehow
   still carries an `expiresAt`.

2. **Conditional schema default.** The `expiresAt` default only produces a
   timestamp when the document's status is `pending` (or unset at creation).
   Records created directly in a terminal state — e.g. worker-created confirmed
   donations/purchases from the reconciliation service — are never born with an
   expiry.

3. **Pre-save hook (runtime).** A `pre("save")` middleware clears `expiresAt`
   whenever a document is saved in a terminal status (`confirmed`, `failed`,
   `expired`, `refunded`, `disputed`). Even if a controller forgets to unset it
   explicitly, the model enforces the invariant.

On top of the schema layers, every current transition to a terminal state also
unsets `expiresAt` explicitly for clarity:

- `submitPayment` / `submitDonation` — validation failure, Stellar error,
  verification failure, and confirmation paths.
- `cancelTransaction` — `$unset: { expiresAt: 1 }` alongside `status: "expired"`.
- `submitRefund` / `escalateDispute` — `$unset: { expiresAt: 1 }` alongside the
  terminal status update.
- `promoteTransaction` (reconciliation) and the `verifyPaymentOnChain` job —
  cleared before saving the confirmed/failed row.

## Migrations

Databases created before this invariant may still hold confirmed rows with a
30-minute `expiresAt` and the old blanket TTL index. Run the idempotent
migration to rescue those rows and swap the index:

```bash
node src/migrations/fixTtlTransactionExpiry.js
```

It (1) `$unset`s `expiresAt` on all non-`pending` rows and (2) drops the blanket
`{ expiresAt: 1 }` index and recreates it with the `partialFilterExpression`.
Running it again is a no-op.

## Out of scope

The `Session` and `Refund` collections have their own TTL indexes on
`expiresAt`; those are intentional and correct (revoked/abandoned sessions and
expired refund windows should be reaped) and are not affected by this invariant.
