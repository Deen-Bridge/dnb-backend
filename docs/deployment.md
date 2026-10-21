# Deployment and Runbook

This runbook describes how the Deen Bridge backend is run, based on what is in
this repository (`server.js`, `Dockerfile`, `docker-compose.yml`,
`ecosystem.config.js`, `k8s/`, `.github/workflows/`). Anything the repo does not
establish is marked **unverified**. The repo contains no Render blueprint
(`render.yaml`), so the actual production host setup is **unverified**; the
keep-awake workflow suggests Render, but that is an inference.

Never commit secret values. This document names variables only.

## 1. Environment variables and secrets

The canonical list, with comments, is [`.env.example`](../.env.example). The
boot-time checks live in `src/config/validateEnv.js`.

### Required (boot aborts if missing)

`MONGO_URI`, `JWT_SECRET` (use at least 32 characters), `NODE_ENV`, `PORT`.

Additionally in `NODE_ENV=production`, `validateEnv.js` fails fast when
`AI_SERVICE_KEYS` is missing. It also requires an explicit
`WEBHOOK_SECRET_ENCRYPTION_KEY` (see the checks in that file for the exact
conditions). Stellar configuration is validated at boot too (for example a
mainnet flag paired with a testnet Horizon URL aborts startup); see
[`MAINNET.md`](./MAINNET.md).

### Secrets (store in a secret manager, never in the repo)

Names appear in `.env.example` and `k8s/secrets.yaml.example`:

- Database and auth: `MONGO_URI`, `JWT_SECRET`, `REDIS_PASSWORD` / `REDIS_URL`
  (if the Redis requires auth), `JOBS_DASHBOARD_TOKEN`
- Cloudinary: `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, `CLOUDINARY_URL`
- Email: `SENDLIB_API_KEY`
- Stellar: `FEE_SPONSOR_SECRET`, `SEP10_SIGNING_SECRET`
- Service auth and webhooks: `AI_SERVICE_KEYS`, `WEBHOOK_SECRET_ENCRYPTION_KEY`
- Jitsi: `JITSI_PRIVATE_KEY`, plus related IDs
- Captcha: `CAPTCHA_SECRET_KEY`

### Non-secret configuration

`FRONTEND_URL` (must be the deployed frontend origin, otherwise email
verification links point at localhost), `STELLAR_NETWORK`, `SOROBAN_RPC_URL`
(required on mainnet), `SENDLIB_API_URL`, `EMAIL_FROM`, `PLATFORM_FEE_PERCENT`,
token TTLs, login lockout and rate limit settings, `REDIS_HOST` / `REDIS_PORT`,
Horizon client tunables, scholarship settings, and the `ORG_*` stellar.toml
fields. See `.env.example` for each.

### Process toggles

| Variable | Effect |
| --- | --- |
| `JOBS_ENABLED` | Set to `false` to disable the durable job poller (`src/jobs/queue.js`). |
| `QUEUE_DRIVER` | `mongo` (default outside tests) or `inline`. |
| `INGESTION_WORKER_ENABLED` | `true` runs the payment ingestion worker inside the web process. |
| `WEBHOOK_WORKER_ENABLED` | `true` runs the outbound webhook delivery worker inside the web process. |
| `PLEDGE_SCHEDULER_ENABLED` | `true` runs the pledge scheduler inside the web process. |

Variables read in code but **not** listed in `.env.example`:
`INGESTION_WORKER_ENABLED`, `INGESTION_POLL_INTERVAL_MS`,
`PLEDGE_SCHEDULER_ENABLED`, `PLEDGE_SCHEDULER_INTERVAL_MS`,
`PLEDGE_PAYMENT_WINDOW_MS`, `TRENDING_HASHTAGS_INTERVAL_MS`. The first two are
listed in `validateEnv.js`; the rest were found by grep in `src/`.

## 2. Processes

| Process | Command | Notes |
| --- | --- | --- |
| Web/API server | `npm start` (`node --import dotenv/config server.js`); the Docker image runs `node server.js` | Express plus Socket.IO on `PORT` (default 5000 in code). |
| Standalone ingestion worker | `npm run worker:ingest` (`src/workers/runIngestionWorker.js`) | Connects to MongoDB and runs the Stellar payment ingestion loop. Use this instead of setting `INGESTION_WORKER_ENABLED=true` on the web process; do not run both against the same data (whether concurrent instances are safe is **unverified**). |
| Background jobs | Started in-process by `server.js` (`startJobs()`) | Mongo-backed queue polled every 500 ms; handlers are in `src/jobs/handlers.js`. |
| Anchor transaction poller | Started in-process by `server.js` | Interval poller (`src/jobs/anchorPoller.js`). |
| Trending hashtags job | Started in-process from `app.js` | `setInterval`, default every 1 hour. |
| Webhook delivery worker | In-process, opt-in via `WEBHOOK_WORKER_ENABLED=true` | |
| Pledge scheduler | In-process, opt-in via `PLEDGE_SCHEDULER_ENABLED=true` | Loop interval defaults to 60 s. |

Because the in-process jobs and pollers start in every web instance, running
several replicas runs several pollers. The queue claims work through MongoDB,
but whether every poller is safe under concurrency is **unverified**.

`src/jobs/updateStreaks.ts` and `src/jobs/publishScheduledAnnouncements.ts` are
not imported anywhere in `server.js`, `app.js`, `src/`, `routes/` or
`services/` that this review found, and there is no scheduler entry for them.
Whether something external triggers them is **unverified**.

There is no OS-level cron or Kubernetes CronJob in the repo. The only scheduled
workflow is the keep-awake ping below.

### Keep-awake workflow

`.github/workflows/keep-awake.yml` runs every 15 minutes and `curl`s
`/ping` on a hard-coded `onrender.com` host. It exists to stop a free-tier
Render instance from sleeping. It does not check health.

### Graceful shutdown

On `SIGTERM`/`SIGINT` the server stops accepting connections, stops jobs, the
anchor poller, sockets and the optional workers, closes Redis, then exits. A
forced exit happens after 10 seconds. Note the Kubernetes
`terminationGracePeriodSeconds` is 30 and the PM2 `kill_timeout` is 10000 ms.

## 3. Dependencies

### MongoDB (required)

- `docker-compose.yml`: `mongo:7.0`.
- CI (`.github/workflows/ci.yml`): `mongo:6.0`.
- Connection via `MONGO_URI`. Optional pool and replica set tuning:
  `MONGO_REPLICA_SET`, `MONGO_READ_PREFERENCE`, `MONGO_MAX_POOL_SIZE`,
  `MONGO_MIN_POOL_SIZE`. The production version is **unverified**; the repo
  tests against 6.0 and develops against 7.0.
- Seed/migration scripts are in `package.json` (`db:seed*`, `migrate:*`).

### Redis (effectively required for readiness)

- `docker-compose.yml`: `redis:7-alpine`. CI boot job: `redis:7`.
- Configure with `REDIS_URL` or `REDIS_HOST`/`REDIS_PORT` (+ optional
  `REDIS_USERNAME`/`REDIS_PASSWORD`).
- The app continues to start if Redis fails to initialise (a warning is
  logged), and `.env.example` calls Redis optional. However `/health` reports
  unhealthy (HTTP 503) when Redis is down, so with Redis down the container
  and Kubernetes probes will fail. Treat Redis as required wherever `/health`
  is used for probes.
- Cluster and sentinel examples: `redis/` and [`redis.md`](./redis.md).

### Node.js

Docker image: `node:20-alpine`. CI: Node 22. CONTRIBUTING says Node 18+.
`package.json` has no `engines` field that this review checked, so the
required version is **unverified**; prefer matching the Docker image.

## 4. Health and readiness endpoints

Defined in `app.js`, `src/controllers/healthController.js` and
`src/routes/health/database.js`.

| Endpoint | Behavior |
| --- | --- |
| `GET /ping` | Always 200 with body `pong`. Process liveness only; checks no dependency. Used by the keep-awake workflow. |
| `GET /health` | 200 only when MongoDB `readyState` is connected **and** Redis is ready; otherwise 503. JSON includes per-dependency status, uptime and environment. Used by the Dockerfile `HEALTHCHECK`, the compose healthcheck, the Kubernetes probes and the CI boot check. |
| `GET /health/database` | Runs `checkDatabaseHealth()` (`mongo/utils/healthCheck.js`); 200 if healthy, 503 otherwise. MongoDB only. See [`connection-pool-metrics.md`](./connection-pool-metrics.md). |

Because `/health` includes Redis, it is a readiness check rather than a pure
liveness check. If Redis outages should not restart pods, a liveness probe on
`/ping` is an option (not configured today).

## 5. Deploy steps

The repo supports three paths. Which one production uses is **unverified**.
CONTRIBUTING.md states that changes merged to `main` may be deployed to
production, and CI must pass first (`ci.yml`: tests plus a boot-and-`/health`
check).

### Docker / Docker Compose

```bash
docker compose up -d --build     # app + mongo:7.0 + redis:7-alpine
docker compose ps                # healthchecks
```

Note: the compose file hard-codes development values (`NODE_ENV=development`,
a placeholder JWT secret). It is for local use, not production. It publishes
the app on host port `${PORT:-5000}` mapped to container port 5000, while the
`Dockerfile` has `EXPOSE 3000` and its `HEALTHCHECK` probes port 3000. Unless
`PORT` is set to match, the image's built-in healthcheck and the compose
healthcheck (port 5000) disagree. Set `PORT` explicitly when running the image.

Build image only: `docker build -t dnb-backend .`

### Kubernetes (`k8s/`)

1. Create the secret from `k8s/secrets.yaml.example` (copy, fill in real
   values, apply; do not commit the filled file).
2. Review and apply `k8s/configmap.yaml`, then `k8s/deployment.yaml` and
   `k8s/service.yaml`.

```bash
kubectl apply -f k8s/configmap.yaml -f k8s/secrets.yaml \
  -f k8s/deployment.yaml -f k8s/service.yaml
kubectl rollout status deployment/dnb-backend
```

Deployment facts: 3 replicas, `RollingUpdate` with `maxSurge: 1` and
`maxUnavailable: 0`, container port 5000, `/health` for liveness, readiness
and startup probes, non-root user 1001, read-only root filesystem (`/tmp` is an
emptyDir), requests 250m CPU / 256Mi, limits 500m CPU / 512Mi. The service is
`ClusterIP` on port 80 with `ClientIP` session affinity. There is no Ingress in
the repo. The image is `dnb-backend:latest` with `IfNotPresent`; no registry or
image build/push pipeline exists in `.github/workflows/`, so pin a real tag when
deploying (see rollback).

The `k8s/configmap.yaml` includes `MONGO_URI`; because `MONGO_URI` also appears
in the secret example, keep it in only one place (the secret) to avoid it
leaking into a ConfigMap. Which `envFrom` source wins is **unverified**.

There is no standalone worker Deployment in `k8s/`. To run
`npm run worker:ingest` you would need your own manifest (**unverified**,
not provided).

### PM2 (`ecosystem.config.js`)

```bash
pm2 start ecosystem.config.js --env production
pm2 reload ecosystem.config.js --update-env   # zero-downtime reload
```

Cluster mode with `instances: "max"`, `max_memory_restart: 1G`, `PORT` 5000,
logs under `./logs/`. See the file header for `pm2-logrotate` setup. Note the
file uses `export default` (ESM); PM2 loading ESM config may need a recent
PM2 (**unverified**). Cluster mode means one set of in-process pollers per
CPU core (see section 2).

### Render

No Render config exists in the repo. The keep-awake workflow targets an
`onrender.com` host, so production may be a Render web service built from
`main`. Build/start commands, plan and environment setup are **unverified**.
If using Render, the natural settings from `package.json` are build
`npm ci` and start `npm start`, with `/health` or `/ping` as the health check
path.

### After deploying

1. `curl -f https://<host>/health` returns 200 with MongoDB and Redis `up`.
2. `curl -f https://<host>/health/database` returns 200.
3. Check logs for `DeenBridge API running` and startup errors from
   `validateEnv` (it exits with code 1 on missing required variables).
4. If the worker runs standalone, confirm the ingestion worker logs.

## 6. Rollback

The repo has no automated rollback or release tagging, so rollback is by
redeploying a previous known-good revision:

- **Kubernetes:** `kubectl rollout undo deployment/dnb-backend` (and
  `kubectl rollout history deployment/dnb-backend`). With the mutable
  `dnb-backend:latest` tag a rollback may not change the image, so deploy
  immutable tags.
- **PM2:** check out the previous commit, `npm ci`, then
  `pm2 reload ecosystem.config.js --update-env`.
- **Docker:** rebuild from the previous commit (or run the earlier image tag)
  and `docker compose up -d`.
- **Render (if used):** redeploy a previous deploy from the dashboard
  (**unverified**).

Data notes:

- Migrations (`migrate:categories`, `migrate:review-stats`) are run manually
  via npm scripts; no down-migrations exist in the scripts that this review
  found. Back up MongoDB before running them, and treat them as not
  automatically reversible (**unverified** per script).
- Rotating `WEBHOOK_SECRET_ENCRYPTION_KEY` invalidates all stored webhook
  secrets (per `.env.example`), so do not change it as part of a rollback.
- `AI_SERVICE_KEYS` rotation is add-new-then-deactivate-old; see
  [`service-to-service-auth.md`](./service-to-service-auth.md).
- Mainnet switch checklist: [`MAINNET.md`](./MAINNET.md).

## 7. Other deployment notes

- `nginx/` contains an nginx + ModSecurity WAF configuration in front of the
  API (see `nginx/README.md`); whether production uses it is **unverified**.
- The Dockerfile builds with pnpm if `pnpm-lock.yaml` exists and falls back to
  `npm install`; the repo has `package-lock.json`, so the effective install is
  the npm fallback, which does not use `--frozen-lockfile` semantics.
