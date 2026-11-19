# Administrative rate-limit policy

Administrative routes are rate-limited at the application mount and then
authenticated by their route. When an authorization credential is present, the
limiter hashes it for its key without logging or persisting the credential;
requests without credentials fall back to source IP.

| Route family | Default budget | Key | Concurrency policy |
| --- | ---: | --- | --- |
| /api/admin/audit | reads: 120 requests / 15 minutes; mutations: 30 | credential hash or IP | Read-only queries must use the route's existing pagination and projection |
| /api/admin/blocked-ips | reads: 120 requests / 15 minutes; mutations: 30 | credential hash or IP | Mutations remain serialized by the block-store service |
| /api/admin/educator-verification | reads: 120 requests / 15 minutes; mutations: 30 | credential hash or IP | Approval/rejection work is bounded by one request per operation |
| /api/admin/moderation | reads: 120 requests / 15 minutes; mutations: 30 | credential hash or IP | Each action is one queue/state transition |
| /admin/jobs | list: 30 requests / minute; dead jobs: 10 | credential hash or IP | The dead-job view has a separate lower budget |

All limiters return HTTP 429 with the standard RateLimit headers and a stable
JSON message. Each rejection is logged with the limiter prefix, so existing
log shipping can alert on RATE_LIMIT_ADMIN_READ,
RATE_LIMIT_ADMIN_MUTATION, RATE_LIMIT_JOB_READ, and RATE_LIMIT_JOB_DEAD.

Operations may tune or disable a budget with the corresponding
RATE_LIMIT_ADMIN_READ_MAX, RATE_LIMIT_ADMIN_READ_WINDOW_MS,
RATE_LIMIT_ADMIN_READ_DISABLE, RATE_LIMIT_ADMIN_MUTATION_MAX,
RATE_LIMIT_ADMIN_MUTATION_WINDOW_MS, RATE_LIMIT_ADMIN_MUTATION_DISABLE,
RATE_LIMIT_JOB_READ_MAX, RATE_LIMIT_JOB_READ_WINDOW_MS,
RATE_LIMIT_JOB_READ_DISABLE, RATE_LIMIT_JOB_DEAD_MAX,
RATE_LIMIT_JOB_DEAD_WINDOW_MS, and RATE_LIMIT_JOB_DEAD_DISABLE environment
variables. A trusted automation client may supply
X-Rate-Limit-Trusted-Token when RATE_LIMIT_TRUSTED_INTERNAL_TOKEN is configured;
use this only for authenticated internal automation and keep the bypass
observable in logs.

New administrative endpoints must select a route class, use bounded
pagination/timeouts for expensive reads, and document any queue or concurrency
control before rollout. Roll back by restoring the previous route mount and
removing the class-specific environment overrides; retain the rejection logs
and metrics during the rollout.
