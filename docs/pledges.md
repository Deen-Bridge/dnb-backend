# Recurring pledges: history API contract

Issue #698. Covers the read side of `/api/stellar/pledges`. Creating pledges and
paying cycles are described in [payments.md](payments.md); the scheduler that
creates cycles is `src/workers/pledgeScheduler.js`.

All routes require a bearer token and only ever return the caller's own data.

## Endpoints

| Route | Returns | Bounded by |
|---|---|---|
| `GET /api/stellar/pledges` | One page of the caller's pledges | `limit` (max 50) + cursor |
| `GET /api/stellar/pledges/stats` | Aggregate totals only | One `$group` aggregation, no documents returned |
| `GET /api/stellar/pledges/:id/cycles` | One page of a pledge's cycles with payment status | `limit` (max 50) + cursor |

Every query is owner-scoped, projected, and capped at 5 s with `maxTimeMS`
(`QUERY_MAX_TIME_MS`, see [query-budgets.md](query-budgets.md)).

### Pagination

Both list endpoints use keyset (cursor) pagination.

| Query | Rules |
|---|---|
| `limit` | Integer 1-50, default 20. Out-of-range values are rejected with 400, not clamped. |
| `cursor` | Opaque token from the previous page's `pageInfo.nextCursor`. A cursor from the other endpoint, or a tampered one, is rejected with 400. |
| `status` | Pledges only: `active`, `paused` or `cancelled`. |
| `includeArchived` | Cycles only: `true` or `false` (default `false`). |

Repeating a query key (`?limit=5&limit=10`) is a 400.

Every page carries:

```json
"pageInfo": { "limit": 20, "hasMore": true, "nextCursor": "eyJrIjoicGxlZGdlIi..." }
```

Keep requesting with `cursor=<nextCursor>` until `hasMore` is `false`
(`nextCursor` is then `null`). Ordering is stable:

- pledges: `createdAt` descending, then `_id` descending, so rows created in the
  same millisecond are neither skipped nor repeated;
- cycles: `dueAt` descending. `(pledge, dueAt)` is unique, so it is a total order.

Rows inserted after you start paging appear on page one of a fresh listing,
not in the middle of the walk you are on.

### Response shapes

Pledge (also returned by `POST /pledges` and `PATCH /pledges/:id/status`):

```json
{
  "_id": "6650c2f4e1a2b3c4d5e6f701",
  "publicKey": "GBRP...",
  "amount": "5",
  "cadence": "weekly",
  "anchorDay": 5,
  "anchorDate": null,
  "status": "active",
  "nextDueAt": "2026-11-27T09:00:00.000Z",
  "consecutivePaid": 4,
  "longestStreak": 9,
  "totalPaidStroops": "650000000",
  "lastPaidAt": "2026-11-20T09:04:11.000Z",
  "createdAt": "2026-06-01T09:00:00.000Z",
  "updatedAt": "2026-11-20T09:04:11.000Z"
}
```

Cycle:

```json
{
  "_id": "6650c2f4e1a2b3c4d5e6f7a0",
  "pledge": "6650c2f4e1a2b3c4d5e6f701",
  "dueAt": "2026-11-20T09:00:00.000Z",
  "windowEndsAt": "2026-11-23T09:00:00.000Z",
  "status": "paid",
  "archived": false,
  "transaction": {
    "_id": "6650c2f4e1a2b3c4d5e6f7b3",
    "status": "confirmed",
    "stellarTxHash": "3389e9f0f1a65f19736cacf544c2e825313e8447f569233bb8db39aa607c8889",
    "confirmedAt": "2026-11-20T09:04:11.000Z"
  }
}
```

`transaction` is `null` until the cycle has been initialized for payment.

Stats:

```json
{ "success": true, "totalPaidStroops": "650000000", "longestStreak": 9, "active": 2, "paused": 1, "cancelled": 0, "total": 3 }
```

Breaking change: stats no longer echo the full `pledges` array. Use
`GET /api/stellar/pledges` for the list.

## Privacy projection

The projections in `src/services/pledgeReadService.js` are the policy.

| Data | Exposed? | Why |
|---|---|---|
| Pledge `publicKey` | Yes, to the owner | It is the caller's own wallet; the UI shows which wallet a pledge debits. |
| Pledge `user`, `schedulerLockUntil`, `__v` | No | Implicit (always the caller) or scheduler internals. |
| Transaction `status`, `stellarTxHash`, `confirmedAt`, `_id` | Yes | Enough to show payment state and link to an explorer. |
| Transaction `buyerWallet`, `creatorWallet`, `unsignedXdr`, `memo`, `paymentReference`, `expectedHash`, `platformFee`, sponsorship fields, `failureReason`, `retryCount` | No | Payment internals the pledge UI does not need. |

Payment status is only joined for transactions whose `buyer` is the caller, as
a second ownership check.

## Retention and archival

Settled cycles (`paid`, `skipped`, `lapsed`) whose `dueAt` is older than
`PLEDGE_CYCLE_RETENTION_DAYS` (default 365) get `archivedAt` set by the pledge
scheduler loop, at most 500 per pass. Due and notified cycles are never
archived because they are still payable.

- Nothing is deleted. Cycles are part of the financial audit trail
  ([privacy-workflows.md](privacy-workflows.md)).
- Archived cycles are hidden from `GET /:id/cycles` unless
  `includeArchived=true`, and are flagged `archived: true` when shown.
- Totals are unaffected. `totalPaidStroops`, `consecutivePaid` and
  `longestStreak` are running counters on the Pledge, updated when a cycle is
  marked paid, and stats read those counters, not cycle rows.
- Invalid values for `PLEDGE_CYCLE_RETENTION_DAYS` (zero, negative,
  fractional, non-numeric) fall back to the default instead of archiving
  everything.
- The sweep only runs where `PLEDGE_SCHEDULER_ENABLED=true`. It runs in its own
  error guard, so a failed sweep never delays cycle scheduling.

## Telemetry

Exposed on `/metrics`, labelled by `operation` (`list`, `stats`, `cycles`):

| Metric | Type | Notes |
|---|---|---|
| `pledge_read_duration_seconds` | histogram | Also labelled `outcome` (`success`, `not_found`, `error`). |
| `pledge_read_response_bytes` | histogram | Serialized JSON size of successful responses. |
| `pledge_read_items` | histogram | Rows per page (list and cycles only). |

No user, pledge or wallet identifiers are used as labels. Validation failures
are rejected before the controller and show up in the HTTP request metrics
instead.

## Indexes

See [indexes.md](indexes.md#pledge-pledgejs). Mongoose `autoIndex` builds them
on startup; on large collections, build them during a quiet window.
