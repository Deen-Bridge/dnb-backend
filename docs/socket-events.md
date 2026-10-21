# Socket.io Events Catalog

Reference for every Socket.io event defined under `src/sockets/`. Derived from the code; anything not confirmable from the code is marked **unverified**.

## Modules at a glance

| File | Namespace | Wired at boot? |
|------|-----------|----------------|
| `index.js` | (server bootstrap) | Yes: `server.js` calls `initSockets(server)` |
| `paymentGateway.js` | `/` (default) | Yes, registered by `initSockets` |
| `paymentEvents.js` | `/` (event names, rooms, status mapping) | Constants only |
| `paymentNotifier.js` | `/` (server emitters) | Helper functions, no handlers |
| `preferences.socket.js` / `.ts` | `/preferences` | **No** (see note) |
| `reading-progress.socket.js` | `/reading-progress` | **No** (see note) |
| `space-poll.socket.js` / `.ts` | `/space-polls` | **No** (see note) |

> **Note (verified by grep):** `initUserPreferencesSocket`, `initReadingProgressSocket` and `initSpacePollSocket` are not imported or called anywhere outside `src/sockets/`, and `emitPreferenceUpdate` / `emitProgress` have no callers outside their own files. `initSockets` only registers the payment gateway. Until those init functions are called with the `io` instance, the namespaces below are not active.

## Server bootstrap (`index.js`)

- Socket.io is attached to the HTTP server with CORS `credentials: true`, methods `GET`/`POST`.
- Allowed origins: `https://dnb-frontend.vercel.app`, `http://localhost:3000`, `http://localhost:3001`, `https://deenbridge.vercel.app`, `http://deenbridge.vercel.app`. Requests with no `Origin` header (non-browser clients) are allowed. Others are rejected with `Not allowed by CORS`.
- `getIO()` returns `null` if sockets are not running; emitters no-op in that case.
- Note that the CORS check applies server-wide, so it would also apply to the other namespaces once wired.

## 1. Payments (default namespace `/`)

Files: `paymentGateway.js`, `paymentEvents.js`, `paymentNotifier.js`.

### Connection and auth

Authentication is required, enforced by a handshake middleware (`io.use`). The JWT is read from, in order:

1. `handshake.auth.token`
2. `handshake.auth.headers.authorization` or `handshake.auth.authorization` (`Bearer <token>`)
3. `handshake.auth.cookie` containing `authToken=<token>`

The token is verified with `JWT_SECRET` (the code falls back to a hardcoded default if the env var is unset), and `decoded.userId` must match an existing `User`. Handshake errors (the connection is refused with `connect_error`):

- `No token, authorization denied`
- `Not authorized, token failed`
- `User not found`
- `Authentication error` (unexpected failure)

On connect the socket joins room `user:<userId>`.

### Rooms

- `user:<userId>`: joined automatically on connect.
- `payment:<transactionId>`: opt-in via `payment:subscribe`.

### Inbound events (client to server)

| Event | Payload | Who may emit |
|-------|---------|--------------|
| `payment:subscribe` | `{ transactionId?: string, reference?: string }` (one of the two; must be a string). Optional ack callback. | Authenticated user who is the `buyer` or `creator` of the transaction |
| `payment:unsubscribe` | `{ transactionId?: string, reference?: string }`. Optional ack callback. | Any authenticated socket |
| `payment:ack` | Ignored. Reserved for future ack-only probes; the handler is a no-op. | Any authenticated socket |

Ack replies (via the callback, not a separate event):

- Subscribe success: `{ ok: true, room: "payment:<id>" }`
- Errors: `{ ok: false, error: "transactionId is required" | "Transaction not found" | "Not authorized for this transaction" | "Subscription failed" }`
- Unsubscribe: `{ ok: true }` or `{ ok: false, error: "transactionId is required" }`

Callers that omit the callback still work (fire and forget).

Caveats:

- `handleSubscribe` resolves a `reference` (`expectedHash`) by calling `findById(filter)` with a filter object. This looks like it may not work as intended for references or even ids (**unverified**, not tested).
- `payment:unsubscribe` leaves `payment:<identifier>` using the identifier as given, without resolving a `reference` to an id, so unsubscribing by `reference` does not leave the room.

### Outbound events (server to client)

| Event | Payload | When it fires |
|-------|---------|---------------|
| `payment:status` | `PaymentStatusEvent` (below) | `notifyPaymentStatus(transaction)` / `notifyPaymentStatusLean(raw)` is called after a transaction status change. Emitted to `payment:<txId>`, the buyer's `user:` room and the creator's `user:` room (if present). |

`PaymentStatusEvent`:

```
{
  transactionId: string,
  reference?: string,          // expectedHash
  status: "pending" | "success" | "failed",
  rawStatus: "pending"|"submitted"|"retrying"|"confirmed"|"failed"|"expired"|"refunded"|"disputed",
  type: "purchase" | "donation",
  itemTitle?: string,
  amount: string,
  currency: string,            // defaults to "USDC"
  stellarTxHash?: string,
  failureReason?: string,
  updatedAt: string            // ISO timestamp
}
```

Status mapping: `pending|submitted|retrying` to `pending`; `confirmed` to `success`; `failed|expired|refunded|disputed` to `failed`.

Where the notifier is called from is **unverified**: grep found no callers outside `src/sockets/` (a Transaction model hook is referenced in comments only). Emits are best-effort; errors are logged and swallowed. A user in two of the target rooms (e.g. buyer subscribed to `payment:<id>`) can receive the same event more than once, since each room is emitted separately and rooms are not de-duplicated by the code (Socket.io only de-duplicates within a single multi-room emit).

## 2. Preferences (`/preferences`)

File: `preferences.socket.js`.

### Connection and auth

No authentication middleware. Any client that passes CORS can connect. Nothing verifies that the `userId` sent in join events belongs to the caller, so any client could join any user's preferences room (security concern; **unverified** whether a global auth guard exists elsewhere).

### Inbound events

| Event | Payload | Who may emit |
|-------|---------|--------------|
| `join_preferences_room` | `userId` (string). Ignored if falsy. | Any connected client |
| `leave_preferences_room` | `userId` (string). Ignored if falsy. | Any connected client |

Room: `user_preferences_<userId>`. No ack, no error event.

### Outbound events

| Event | Payload | When it fires |
|-------|---------|---------------|
| `preference_updated` | `{ userId, preferences, timestamp }` (`timestamp` is an ISO string) | `emitPreferenceUpdate(userId, preferences)` is called; emits to the user's room. Returns `true` on success, `false` if not initialized, no `userId`, or an error. Callers: none found (**unverified**). |

## 3. Reading progress (`/reading-progress`)

File: `reading-progress.socket.js`.

### Connection and auth

No authentication middleware, and no check that the `userId` belongs to the caller (same concern as preferences).

### Inbound events

| Event | Payload | Who may emit |
|-------|---------|--------------|
| `join_reading_progress_room` | `userId` (string; not validated, so a falsy value joins `reading_progress_undefined` and similar) | Any connected client |
| `leave_reading_progress_room` | `userId` (string) | Any connected client |

Room: `reading_progress_<userId>`. No ack, no error event.

### Outbound events

| Event | Payload | When it fires |
|-------|---------|---------------|
| `reading_progress_updated` | The `progress` object passed to `emitProgress(userId, progress)` (shape defined by the caller; **unverified**) | `emitProgress` is called; emits to the user's room. Returns `false` (no-op) if not initialized or no `userId`. Callers: none found (**unverified**). |

## 4. Space polls (`/space-polls`)

File: `space-poll.socket.js`; logic in `src/services/space-poll.service.js`.

### Connection and auth

No socket-level authentication. Authorization is done only inside the service using ids sent in the payload (`hostId`, `userId`), which are client-supplied and not tied to a socket identity. Treat as spoofable (**unverified** whether anything else guards this).

### Inbound events

| Event | Payload | Who may emit (as enforced by the service) |
|-------|---------|-------------------------------------------|
| `join_space_poll_room` | `spaceId` (string) | Any connected client |
| `leave_space_poll_room` | `spaceId` (string) | Any connected client |
| `create_poll` | `{ spaceId, hostId, question, options }`. `options` is an array of at least 2 strings (or objects with `text`). | `hostId` must equal the space's host |
| `cast_vote` | `{ pollId, userId, optionIndex }` | Any user id; poll must be `active`, `optionIndex` must exist. Votes are upserted, so re-voting changes the vote. |
| `close_poll` | `{ pollId, hostId }` | `hostId` must be the space host or poll creator |

Room: `space_poll_<spaceId>`. Note the handlers do not check that the emitting socket has joined the room, and the result is broadcast to the room.

### Outbound events

| Event | Payload | When it fires |
|-------|---------|---------------|
| `poll_created` | Poll result object | After `create_poll` succeeds; to `space_poll_<spaceId>` |
| `poll_results_updated` | Poll result object | After `cast_vote` succeeds; to `space_poll_<poll.space>` |
| `poll_closed` | Poll result object | After `close_poll` succeeds; to `space_poll_<poll.space>` |
| `poll_error` | `{ message: string }` | A handler threw; sent only to the emitting socket |

Poll result object (from `getPollResults`):

```
{
  _id, space, creator /* populated: name, email, avatar */, question,
  status: "active" | "closed", closedAt, createdAt, updatedAt,
  totalVotes: number,
  results: [{ optionIndex, text, votes, percentage }],
  userVote: number | null   // only set when a userId is passed (not for created/closed)
}
```

Service error messages seen: `Space not found`, `Only the host can create polls for this space`, `At least two options are required to create a poll`, `Poll not found`, `Poll is closed for voting`, `Invalid option selected`, `Only the space host or poll creator can close this poll`.

Because `poll_results_updated` is broadcast, `userVote` in that payload reflects the voter, so other room members would receive the voter's `userVote` value (**unverified** client handling).

## Error and ack conventions

| Module | Convention |
|--------|------------|
| Payments | Handshake errors via `connect_error`. Inbound events reply through an optional ack callback `{ ok, ... }`. `payment:ack` is not an error channel. |
| Preferences | None. Invalid input is silently ignored. Emitter returns a boolean. |
| Reading progress | None. Emitter returns a boolean. |
| Space polls | Errors are emitted back to the sender as `poll_error` `{ message }`. No ack callbacks. |

Event names are not consistent across modules: payments use `noun:verb` (`payment:status`), the others use `snake_case`.
