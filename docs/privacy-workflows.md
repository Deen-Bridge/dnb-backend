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
