# Privacy export and deletion workflows

Privacy requests are authenticated at /api/users/me/privacy-requests and
require an Idempotency-Key. The key is scoped to the authenticated user and
request type, so retries cannot create duplicate workflows.

The workflow inventories the account profile, sessions, notifications,
preferences, reading progress, journey analytics, and media references.
Passwords, refresh tokens, MFA secrets, and reset tokens are never exported.
Audit and financial records are retained because they are append-only or
subject to accounting, fraud, and legal-hold requirements.

Deletion revokes sessions, clears user cache keys, removes user-owned
notifications/preferences/progress/analytics rows, then quarantines the
account by anonymising its identity and removing credentials. Each step is
recorded on the request, so a failed step can be retried without repeating
completed work.

Request contract:

- POST /api/users/me/privacy-requests with { type: export | delete }
- GET /api/users/me/privacy-requests/:requestId for status and progress
- POST /api/users/me/privacy-requests/:requestId/retry for failed deletion steps

Export payloads expire after 15 minutes. Production deployments should set
PRIVACY_EXPORT_ENCRYPTION_KEY and move the encrypted payload to a private,
short-lived object store before enabling external archive downloads.

All requests and completion outcomes emit redacted audit events. Financial,
audit, and legally held records are intentionally not deleted; operators must
use the documented retention and legal-hold process for those records.

## Notification retention

Notification rows are retired by a scheduled job
(`src/jobs/notificationRetentionJob.js`, issue #646) rather than by a TTL index,
because the window depends on the row's state rather than only its age. Defaults:

| Category | Default window | Environment override |
|---|---|---|
| Soft-deleted by the user (`isDeleted`) | 30 days | `NOTIFICATION_RETENTION_DELETED_DAYS` |
| Read (`isRead`, not deleted) | 90 days | `NOTIFICATION_RETENTION_READ_DAYS` |
| Unread | 365 days | `NOTIFICATION_RETENTION_UNREAD_DAYS` |

`system` and `pledge_due` notifications are never purged: they carry
account/security meaning rather than feed content. The job runs once on boot and
then daily (`NOTIFICATION_RETENTION_INTERVAL_MS`), takes a distributed lease
when Redis is available, is safe to re-run, and emits
`notification_retention_deleted_total{category}` plus an
`notification.retention_purged` audit event whenever it removes anything.
Set dry-run behaviour by calling `purgeNotifications({ dryRun: true })` from a
shell when you want to preview a policy change before deploying it.
