# Badge privacy and route contract

Badge definitions are public metadata. `GET /api/badges` returns only the
allowlisted definition fields `name`, `slug`, `description`, `icon`,
`category`, and `threshold`.

Award records are private because they can disclose a user's participation and
progress. `GET /api/badges/user/:userId` and `GET /api/users/:userId/badges`
require a valid bearer token and allow access only when the authenticated user
is the target user or an administrator. `GET /api/badges/my-badges` is the
current user's equivalent route.

Unauthorized and malformed user IDs return the same `404 User badges not
found` response. This prevents the route from becoming an existence oracle.
There is no public share-token contract yet; a future share feature must use a
revocable, non-sequential token and retain this private-by-default behavior.

The user-record response is limited to `badge` and `awardedAt`; populated
badges use the same six-field allowlist as the public catalog. The route is
mounted behind the standard generous read limiter, and removing the anonymous
lookup eliminates the sensitive public lookup abuse surface. Any future
public sharing route must add an audit event and its own abuse controls.

## Review checklist

- Confirm the route is protected and owner/admin authorization is enforced.
- Confirm invalid and unauthorized IDs have indistinguishable responses.
- Confirm only the documented badge fields are selected.
- Add authorization, invalid-ID, and revoked-share tests before introducing a
  share-token route.
- Review any index or token rollout and keep a rollback plan.
