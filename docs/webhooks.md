# Outbound Signed Webhooks (issue #45)

DeenBridge emits signed HTTP callbacks so external consumers (the dnb-ai
service, educator tooling, analytics) can react to payment and enrollment
lifecycle events instead of polling the REST API.

## Event catalog

| Event | Emitted when |
| --- | --- |
| `payment.initialized` | A pending purchase transaction is created (`initializePayment`) |
| `payment.confirmed` | A payment is confirmed on-chain (`submitPayment`) |
| `payment.failed` | A payment fails validation / submission / verification (`submitPayment`) |
| `payment.expired` | A pending transaction is cancelled/expired (`cancelTransaction`) |
| `course.enrolled` | A user enrolls in a (free) course (`enrollInCourse`) |
| `wallet.connected` | A user connects a Stellar wallet (`connectWallet`) |
| `wallet.disconnected` | A user disconnects a wallet (`disconnectWallet`) |
| `ping` | Manually, via the management API, for integration testing |

Emission is **fire-and-forget** and happens **only after the Mongo transaction
commits** — a rolled-back payment emits nothing, and a webhook problem can
never block or fail the originating HTTP request.

## Payload envelope

```json
{
  "eventId": "b2f1c0e6-...",         // unique per event; use for idempotency
  "type": "payment.confirmed",
  "createdAt": "2025-01-01T12:00:00.000Z",
  "apiVersion": "2025-01-01",
  "data": { "transactionId": "...", "amount": "10.00", "stellarTxHash": "..." }
}
```

`data` is restricted to an explicit allowlist (ids, wallet public keys,
amounts, currency/network, tx hash, item references). **It never contains
emails, password hashes, secrets, or full user documents.**

## Signature scheme

Each delivery carries these headers:

| Header | Value |
| --- | --- |
| `X-DeenBridge-Event` | the event type, e.g. `payment.confirmed` |
| `X-DeenBridge-Event-Id` | the `eventId` (idempotency key) |
| `X-DeenBridge-Timestamp` | unix seconds when the request was signed |
| `X-DeenBridge-Signature` | `v1=<hex hmac-sha256(secret, "{timestamp}.{rawBody}")>` |

The signed string is `` `${timestamp}.${rawBody}` `` where `rawBody` is the
**exact** bytes of the request body. The server serializes the body once, signs
those bytes, and sends the same buffer — so a verifier must run the HMAC over
the raw received body, not a re-serialized copy (JSON key order can differ).

### Consumer verification (copy-paste Node snippet)

```js
import crypto from "crypto";

// `rawBody` must be the raw request body string/buffer, NOT JSON.parse'd back.
export function verifyDeenBridgeWebhook(req, rawBody, secret) {
  const timestamp = req.headers["x-deenbridge-timestamp"];
  const header = req.headers["x-deenbridge-signature"] || "";
  const [version, provided] = header.split("=");
  if (version !== "v1" || !provided) return false;

  // Reject stale deliveries (replay protection): 5 minutes.
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(skew) || skew > 300) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");

  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

Always compare in constant time (`crypto.timingSafeEqual`) and reject stale
timestamps. Respond `2xx` to acknowledge; any other status (or a timeout)
triggers a retry.

## Delivery, retries, and dead-letter

A background worker (`services/webhooks/deliveryWorker.js`, enabled with
`WEBHOOK_WORKER_ENABLED=true`) claims due deliveries one at a time with an
atomic `findOneAndUpdate` so multiple loops/instances never double-send the
same row. Each POST has a ~10s timeout and does **not** follow redirects.

- `2xx` → `delivered`.
- Otherwise the attempt is recorded and the delivery is retried on an
  exponential backoff-with-jitter schedule: **1m, 5m, 30m, 2h, 12h**.
- After `WEBHOOK_MAX_ATTEMPTS` (default 6) it becomes `dead`.
- Dead deliveries can be requeued via
  `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver`.
- After `WEBHOOK_AUTO_DISABLE_THRESHOLD` (default 5) consecutive dead
  deliveries the endpoint is auto-disabled (`isActive:false`, `disabledReason`)
  and a warning is logged. Re-enable it via `PATCH /api/webhooks/:id`.

All scheduling state lives in the `WebhookDelivery` document, so the loop can
later be swapped onto the durable job queue (issue #32) without a schema change.

## Secret storage

Signing secrets are generated server-side, returned to the caller **exactly
once** (at creation and on rotation), and stored **encrypted at rest**
(AES-256-GCM, key derived from `WEBHOOK_SECRET_ENCRYPTION_KEY`). Encryption
(not hashing) is required because the worker must recover the plaintext to
compute the HMAC on every attempt. The encrypted column is `select:false` and
stripped from every API response; no read endpoint ever returns the secret.

## SSRF protection

Endpoint URLs are validated at **registration** and again at **delivery**:
`https` is required outside development, and loopback / RFC-1918 /
link-local / other non-routable targets are rejected (literal IPs always; DNS
is additionally resolved in production). Residual limitation: DNS rebinding
between resolution and connect (TOCTOU) is not fully closed — that would
require pinning the resolved IP onto the connecting socket.

## Management API

All routes require an authenticated **admin** (`protect` + `authorizeRoles("admin")`).

| Method & path | Purpose |
| --- | --- |
| `POST /api/webhooks` | Register an endpoint (returns `secret` once) |
| `GET /api/webhooks` | List your endpoints (no secret) |
| `GET /api/webhooks/:id` | Get one endpoint |
| `PATCH /api/webhooks/:id` | Update url/events/description/isActive |
| `DELETE /api/webhooks/:id` | Delete an endpoint |
| `POST /api/webhooks/:id/rotate-secret` | Rotate the secret (returns new `secret` once) |
| `GET /api/webhooks/:id/deliveries` | Paginated, `?status=` filterable delivery history |
| `POST /api/webhooks/:id/deliveries/:deliveryId/redeliver` | Requeue a delivery |
| `POST /api/webhooks/:id/ping` | Emit a signed `ping` event to the endpoint |
