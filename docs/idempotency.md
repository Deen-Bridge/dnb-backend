# Request-Level Idempotency

DeenBridge Backend provides header-driven request idempotency on all mutating payment, donation, refund, and payout endpoints. This prevents retried HTTP requests (due to flaky mobile connectivity, proxy retries, or double-tapped UI buttons) from creating duplicate transactions, submitting duplicate Stellar on-chain payments, or double-crediting educators.

## Header

Clients pass the `Idempotency-Key` HTTP header with a unique identifier (e.g. UUID v4):

```http
POST /api/stellar/payment/initialize HTTP/1.1
Host: api.deenbridge.app
Authorization: Bearer <token>
Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
Content-Type: application/json

{
  "itemType": "book",
  "itemId": "65b82e80cbf0776967aab8fe",
  "buyerWallet": "GBKENR..."
}
```

## Behavior & Lifecycle

1. **First Use (`in_progress`)**:
   An `IdempotencyKey` record is atomically inserted with `status: "in_progress"` scoped to `{ key, userId, endpoint }`. A Mongo unique compound index guarantees atomicity under concurrent requests.
2. **Captured Response (`completed`)**:
   Upon handler completion, the HTTP status code and JSON response body are captured and persisted with `status: "completed"`.
3. **Replay**:
   Subsequent requests with the same `Idempotency-Key`, matching body, and same user immediately receive the stored status code and response body without re-executing controller logic or database/on-chain mutations.
4. **Expiration (TTL)**:
   Idempotency keys automatically expire after 24 hours via MongoDB TTL index.

## Error Responses & Concurrency

| Scenario | HTTP Status | Response Description |
|----------|-------------|----------------------|
| **In-Flight Concurrency** | `409 Conflict` | A second request with the same idempotency key is already `in_progress`. Clients should back off and retry. |
| **Payload Mismatch** | `422 Unprocessable Entity` | The idempotency key was reused with a different request body fingerprint. |
| **Server Failure (5xx)** | — | Idempotency keys are purged on 5xx errors so clients can safely retry after a backend failure. |

## Supported Endpoints & Policy

Idempotency key protection is enabled on all mutating payment endpoints (`required: false` policy for backward compatibility):

- `POST /api/stellar/payment/initialize`
- `POST /api/stellar/payment/submit`
- `POST /api/stellar/payment/transactions/:id/refund-request`
- `POST /api/stellar/payment/refunds/:refundId/build`
- `POST /api/stellar/payment/refunds/:refundId/submit`
- `POST /api/stellar/payment/refunds/:refundId/reject`
- `POST /api/stellar/payment/refunds/:refundId/dispute`
- `POST /api/stellar/donation/initialize`
- `POST /api/stellar/donation/submit`
- `POST /api/payouts/build`
- `POST /api/payouts/:batchId/submit`
