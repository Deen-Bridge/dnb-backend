# Service-to-Service (S2S) Authentication

The backend authenticates the AI service (**dnb-ai**) with **signed, scoped,
rotatable keys** — not a single shared static secret. Each request is signed
with an HMAC-SHA256 signature over a canonical string, using a key selected by
its `kid`. This gives replay protection, constant-time verification, per-key
scopes, and **zero-downtime key rotation** via overlapping active `kid`s.

- Middleware: `src/middlewares/serviceAuth.js` (`requireServiceAuth({ scope })`)
- Key store: `src/config/serviceKeys.js` (parses `AI_SERVICE_KEYS`)
- Guarded route (reference): `GET /api/internal/ai/whoami`
  (scope `ai:read-content`) — reflects the authenticated service identity.

Denied attempts are recorded to the audit log as `service_auth.denied`
(`status: "failure"`).

## Headers

Every S2S request MUST send all four headers:

| Header             | Meaning                                                        |
| ------------------ | ------------------------------------------------------------- |
| `X-Service-Id`     | Logical caller id, e.g. `dnb-ai`                              |
| `X-Service-Key-Id` | The key id (`kid`) selecting which secret to sign with        |
| `X-Timestamp`      | Unix time in **seconds** at signing (string)                 |
| `X-Signature`      | Lowercase hex HMAC-SHA256 of the canonical string             |

## Canonical signing string

The signature is computed over this exact string — four fields joined by a
single `\n` (LF), with **no trailing newline**:

```
METHOD \n PATH \n TIMESTAMP \n sha256hex(rawBody || "")
```

- `METHOD` — HTTP method, uppercased (`GET`, `POST`, …).
- `PATH` — the request path exactly as sent, **including any query string**
  (Express `req.originalUrl`, e.g. `/api/internal/ai/whoami`).
- `TIMESTAMP` — the same value sent in `X-Timestamp` (Unix seconds).
- `sha256hex(rawBody || "")` — lowercase hex SHA-256 of the **raw request body
  bytes**; for a bodyless `GET` this is the SHA-256 of the empty string
  (`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`).

Then:

```
signature = HMAC_SHA256(key.secret, canonicalString)   // lowercase hex
```

### Reference client (Node.js)

```js
import crypto from "crypto";

function signRequest({ method, path, secret, kid, serviceId, body }) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const bodyHash = crypto.createHash("sha256").update(body || "").digest("hex");
  const canonical = [method.toUpperCase(), path, timestamp, bodyHash].join("\n");
  const signature = crypto.createHmac("sha256", secret).update(canonical).digest("hex");
  return {
    "X-Service-Id": serviceId,
    "X-Service-Key-Id": kid,
    "X-Timestamp": timestamp,
    "X-Signature": signature,
  };
}
```

> **Body canonicalization caveat:** the digest is over the exact bytes the
> client transmits. Sign the *serialized* body you actually send (do not
> re-serialize on the server side). For JSON, sign the exact string passed to
> the HTTP client.

## Replay protection

Requests whose `X-Timestamp` differs from the server clock by more than
**±300 seconds** (`REPLAY_WINDOW_SECONDS`) — in either direction — are rejected
with `401`. Keep client and server clocks in sync (NTP).

## Verification / response matrix

| Condition                                            | Result |
| ---------------------------------------------------- | ------ |
| Valid signature, permitted scope                     | `2xx`  |
| Missing any of the four headers                      | `401`  |
| Timestamp outside the ±300s window                   | `401`  |
| Unknown `kid`, or a retired (`active: false`) `kid`  | `401`  |
| Signature mismatch (bad/forged)                      | `401`  |
| Valid signature but key lacks the route's scope      | `403`  |

All secret/signature comparisons use `crypto.timingSafeEqual`
(length-guarded — a length mismatch is a plain non-match, never a throw).

## Scopes

Scopes are per-key and asserted per-route. Current scopes:

| Scope             | Grants                                              |
| ----------------- | --------------------------------------------------- |
| `ai:read-content` | Read content the AI service needs (e.g. `whoami`)   |
| `ai:write-answers`| Reserved for AI write-back endpoints (future)       |

A key only passes a route when its `scopes` array `includes` that route's
required scope.

## Key configuration (`AI_SERVICE_KEYS`)

Keys are provisioned via the `AI_SERVICE_KEYS` env var — a JSON array:

```json
[
  {
    "kid": "k1",
    "secret": "a-long-random-hmac-secret",
    "scopes": ["ai:read-content"],
    "active": true
  }
]
```

- **Required in production** — boot fails fast (`validateEnv.js`) if it is
  missing. Optional in development/test.
- Multiple entries may be `active` at once (this is what enables rotation).
- `active: false` retires a key without removing it.
- Malformed JSON or bad entries are skipped safely (empty key set → every S2S
  request is rejected `401`; the process never crashes on parse).

## Key-rotation runbook (zero downtime)

Because multiple `kid`s can be active simultaneously, rotation never has a
window where valid callers are rejected:

1. **Add** a new key with a fresh `kid` (e.g. `k2`) alongside the current one,
   both `"active": true`:
   ```json
   [
     {"kid":"k1","secret":"OLD","scopes":["ai:read-content"],"active":true},
     {"kid":"k2","secret":"NEW","scopes":["ai:read-content"],"active":true}
   ]
   ```
2. **Deploy** the backend with both keys active. Now `k1` and `k2` are both
   accepted.
3. **Switch dnb-ai** to sign with `k2` (its `X-Service-Key-Id`). Verify traffic
   is flowing under `k2`.
4. **Retire** `k1` by setting `"active": false` (or removing it) and redeploy.
   `k1`-signed requests now get `401`; `k2` continues uninterrupted.

At no point is there a gap where a correctly-signed request is rejected.
