# Architecture Overview

DeenBridge backend is a single Node.js (ESM) Express app backed by MongoDB (Mongoose), with optional Redis, Socket.io, and in-process background work. This page maps the layers and where to put code. Paths are relative to the repo root. Anything not confirmed in code is marked "unverified".

## Process bootstrap

- `server.js`: loads env, runs `validateEnv`, connects Mongo (`src/config/db.js`), imports `app.js`, inits Redis (failure is non-fatal), creates the HTTP server, attaches Socket.io (`initSockets`), starts the job queue (`startJobs`) and the anchor poller. The payment-ingestion worker, webhook delivery worker and pledge scheduler start only when `INGESTION_WORKER_ENABLED`, `WEBHOOK_WORKER_ENABLED`, `PLEDGE_SCHEDULER_ENABLED` are `"true"`. It also handles graceful shutdown on SIGTERM/SIGINT.
- `app.js`: builds the Express app: request id and logging, Prometheus metrics, helmet/CORS, body parsing, Mongo-sanitize/HPP/`sanitizeInput`, activity tracking, then route mounts (each with a rate limiter from `src/middlewares/security.js`), then `notFound` and `errorHandler`.

## Layers

Request flow: **routes -> middlewares -> controllers -> services -> models**.

| Layer | Location | Responsibility |
|---|---|---|
| Routes | `src/routes/**` | Map method + path to an ordered middleware chain and one controller. No logic. Mounted in `app.js`. Versioned routers live in `src/routes/api/v1`, `v2`. |
| Middlewares | `src/middlewares/*.js` | Cross-cutting request concerns (see below). |
| Controllers | `src/controllers/**` | Translate HTTP to a domain call: read `req`, call services/models, shape the response. |
| Services | `src/services/**` | Business rules, orchestration, external systems (Stellar, email, webhooks, audit, search). |
| Models | `src/models/*` | Mongoose schemas and persistence. |
| Validators | `src/validators/*.js` | `express-validator` rule chains, used in routes ahead of `validate`. |
| Sockets | `src/sockets/*` | Socket.io server (`index.js`), payment gateway/notifier/events, reading-progress, polls, preferences. HTTP code emits to clients via `getIO()`, which returns `null` when no server is running. |
| Jobs | `src/jobs/*` | `queue.js` is a Mongo-backed queue (`Job` model; `inline` driver in tests) with retries and backoff. `handlers.js` registers handlers (`registerJob`). Also timer-style jobs (`anchorPoller.js`, `trendingHashtagsJob.js`). |
| Workers | `src/workers/*` | Long-running pollers: `paymentIngestionWorker.js` (Horizon -> reconciliation), `pledgeScheduler.js`. The webhook delivery worker is in `src/services/webhooks/deliveryWorker.js`. |
| Config / utils | `src/config/*`, `src/utils/*` | Env validation, DB, Redis, logger, metrics, error codes; helpers such as `utils/cache.js`. |

## Rule: controllers stay thin, business logic lives in services

Intended: a controller validates nothing itself, makes no domain decisions, and delegates to a service. **The code does not consistently follow this.** Honest picture:

- Followed in newer features, e.g. badges, certificates, bundles, quizzes, reading groups, polls, highlights, each with a `*.service.*` consumed by a `*.controller.*`.
- Not followed in older or core areas. `src/controllers/stellar/paymentController.js` (about 1,300 lines) imports `User`, `Book`, `Course`, `Transaction` directly, opens Mongoose sessions/transactions, builds Stellar transactions, enqueues jobs and emits webhooks inline. `authController.js` (about 1,270 lines), `userController.js` and `courses/courseController.js` also query models directly.
- Some route files and `authMiddleware.js` use models directly (e.g. `protect` loads `User`); `authorize.js` loads the target model for ownership checks.

New code should put rules in a service and keep the controller to request parsing and response shaping. Refactoring the legacy controllers is not done wholesale.

Other inconsistencies to know about (verified by listing, not by auditing):

- Both `src/middlewares/` (all active middleware) and `src/middleware/` (only `analytics/`) exist.
- Many modules exist as both `.js` and `.ts` (e.g. `badge.controller.js`/`.ts`); which is canonical for each is unverified.
- Top-level `routes/` and `services/` directories (health, metrics, calls, emails) sit outside `src/`; `src/routes/health` and `src/routes/metrics` also exist.

## Cross-cutting concerns

- **Authentication**: `protect` in `src/middlewares/authMiddleware.js` verifies the Bearer JWT, loads the user into `req.user`. Also in that file: `authorizeRoles`/`restrictTo`/`authorize` (role check), `require2FA`, `requireVerified`, `requireVerifiedEducator`. Service-to-service calls (`/api/internal/ai`) use HMAC-signed requests via `src/middlewares/serviceAuth.js` (see `docs/service-to-service-auth.md`). The JWT secret falls back to a hardcoded default if `JWT_SECRET` is unset (`authMiddleware.js`); worth reviewing.
- **Authorization (ownership)**: `authorizeOwnership({ model, ownerField, resourceType })` in `src/middlewares/authorize.js` allows owner or admin, audits denials, attaches `req.resource`. Used e.g. in `src/routes/spaceRoutes.js`. See `docs/authorization-matrix.md`.
- **Validation / sanitization**: rule chains in `src/validators/*.js` followed by `validate` (`src/middlewares/validate.js`), which turns failures into a 400 `APIError` with field details. `sanitizeInput` (same file) strips HTML globally from body/query/params; `mongoSanitizeMiddleware` and `hppMiddleware` come from `security.js`. Not every route has a validator.
- **Idempotency**: `idempotency()` in `src/middlewares/idempotency.js`, backed by `src/models/IdempotencyKey.js`. Keyed on the `Idempotency-Key` header + user + endpoint + SHA-256 of the body; a replay returns the stored response, a different body gives 422, a concurrent duplicate gives 409. Optional unless `{ required: true }`. See `docs/idempotency.md`.
- **Error handling**: throw `APIError` (`src/middlewares/errorHandler.js`) and wrap async handlers in `catchAsync`; `errorHandler` maps Mongoose/JWT/Multer errors and emits `{ success: false, error: { code, message, details } }` using `src/config/errorCodes.js`. Not uniform: `protect` and `initializePayment` write their own error JSON (the latter via `buildErrorResponse`) instead of throwing.
- **Caching**: `cacheMiddleware(ttl, keyGen)` in `src/middlewares/cache.js` caches GET JSON responses in Redis through `src/utils/cache.js` (TTL constants in `CACHE_TTL`); applied on routes such as `userRoutes.js`, `searchRoutes.js`, `spaceRoutes.js`. Redis is optional. See `docs/caching.md`.
- **Rate limiting / security headers**: `security.js` (`authLimiter`, `standardLimiter`, `generousLimiter`, `paymentLimiter`, helmet), applied per mount in `app.js`.
- **Audit and webhooks**: `recordAudit` in `src/services/audit/auditService.js`; outbound events via `emitEvent` in `src/services/webhooks/webhookService.js`.
- **Observability**: per-request id (`X-Request-Id`) and child logger in `app.js`; `/metrics`, `/health`, `/ping`.

## Example: `POST /api/stellar/payment/initialize`

1. `server.js` -> `app.js`: request id/logging, helmet, CORS, `express.json`, sanitizers run.
2. `app.js` mounts `/api/stellar/payment` with `paymentLimiter` -> `src/routes/stellar/paymentRoutes.js`.
3. Route chain (`paymentRoutes.js`): `protect` (router-wide, `authMiddleware.js`) -> `initializePaymentValidation` (`src/validators/requestValidators.js`) -> `validate` -> `idempotency()` -> `initializePayment`.
4. `initializePayment` (`src/controllers/stellar/paymentController.js`): starts a Mongo session, checks the item type, loads the buyer `User` and wallet, looks for an existing pending `Transaction` (returns it if found), loads the `Book`/`Course`, computes the fee split and builds the Stellar payment XDR via `src/services/stellar/stellarService.js` (`calculateFeeSplit`, `buildPathPaymentTransaction`), saves a new `Transaction` (`src/models/Transaction.js`), commits.
5. After commit: `recordAudit` (audit service) and `emitEvent(PAYMENT_INITIALIZED)` (webhook service), then `res.status(200).json(...)`. The `res.json` wrapper installed by `idempotency()` stores that response on the `IdempotencyKey`.
6. Later, `submitPayment` (same controller) submits the signed XDR and enqueues `verifyPaymentOnChain` / `generateReceipt` via `src/jobs/queue.js`; handlers in `src/jobs/handlers.js` run them (receipt email, earnings via `payoutService`). Status changes can be pushed to clients through `src/sockets/paymentNotifier.js` (call path from the controller unverified). The ingestion worker (`src/workers/paymentIngestionWorker.js`) reconciles on-chain payments independently.
7. Errors: thrown `APIError`s (e.g. from `validate`, `idempotency`) reach `errorHandler`; the controller's own catch returns a 500 JSON itself.

This example also shows the deviation noted above: step 4 is domain logic living in the controller.
