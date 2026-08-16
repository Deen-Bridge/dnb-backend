# Transaction Expiry Lifecycle and TTL Invariant

This document details the transaction lifecycle guarantees and TTL expiry behavior in DeenBridge.

## Overview

Transactions in DeenBridge track item purchases (books and courses) and sadaqah donations. To prevent abandoned checkout sessions from accumulating indefinitely in the database, pending transactions carry an `expiresAt` timestamp.

## The Invariant

> **`expiresAt` is ONLY defined on `pending` transactions. All terminal states MUST clear `expiresAt`, and the TTL index is scoped strictly to `status: "pending"`.**

### Status Invariant Mapping

| Status | `expiresAt` Value | Explanation |
|---|---|---|
| `pending` | `Date` (Now + 30m) | Active checkout attempt awaiting wallet signature / submission. Eligible for TTL reaping upon expiry. |
| `submitted` | `Date` (retained) | In-flight on Stellar network. Transient state before confirmation/failure. |
| `retrying` | `Date` (retained) | In-flight asynchronous verification job. |
| `confirmed` | `undefined` (`$unset`) | Successfully settled on-chain. Item access granted or donation recorded. **Must NEVER be reaped.** |
| `failed` | `undefined` (`$unset`) | Permanent failure (validation or on-chain error). Kept for historical records and audit logs. |
| `expired` | `undefined` (`$unset`) | Manually cancelled or explicitly timed out. Kept for audit trail. |
| `refunded` | `undefined` (`$unset`) | Refund executed on-chain and item access revoked atomically. |
| `disputed` | `undefined` (`$unset`) | Under administrator review/arbitration. |

---

## Architecture Safeguards

DeenBridge employs a defense-in-depth approach across multiple layers:

### 1. Partial Indexing in MongoDB
The MongoDB TTL index on the `Transaction` collection is created with a `partialFilterExpression`:

```js
transactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: "pending" } }
);
```

Even if an application code path leaves an `expiresAt` timestamp on a non-pending record, MongoDB's background TTL thread will never match or delete the document because the document is not indexed.

### 2. Conditional Schema Defaults
The Mongoose schema default for `expiresAt` only produces a timestamp when the document status is `"pending"`:

```js
expiresAt: {
  type: Date,
  default: function () {
    return this.status === "pending" || !this.status
      ? new Date(Date.now() + 30 * 60 * 1000)
      : undefined;
  },
}
```

This prevents background ingestion workers or reconciliation services from accidentally populating `expiresAt` when creating confirmed donation or purchase records directly from on-chain transactions.

### 3. Explicit Unsets on Transitions
All controllers and background job handlers (`paymentController.js`, `donationController.js`, `reconciliationService.js`, `refundController.js`, `jobHandlers.js`) explicitly unset `expiresAt = undefined` or issue `{ $unset: { expiresAt: 1 } }` upon transitioning to any terminal status.

---

## Migrations

Existing databases created prior to this specification can backfill legacy records and upgrade indexes using:

```bash
node src/migrations/fixTtlTransactionExpiry.js
```
