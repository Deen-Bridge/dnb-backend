# Account deletion workflow

Account deletion is a checkpointed privacy workflow, not a direct user-document
delete. Clients should call `POST /api/users/me/privacy-requests` with
`{ "type": "delete" }` and an `Idempotency-Key`, then poll the returned request
until it is `completed` or `partial`. The legacy `DELETE /api/users/:id` route
now delegates to the same workflow and returns `202 Accepted`.

## Data handling matrix

| Data category | Action | Recovery/retention rule |
| --- | --- | --- |
| Profile and credentials | Anonymize and disable | No credentials or social identifiers remain |
| Sessions and refresh tokens | Revoke | Repeated requests are safe |
| Notifications, preferences, reading progress, journey events | Delete | Processed as checkpointed collections |
| Uploaded media | Remove references and quarantine through the media worker | Provider cleanup may be retried |
| Purchases, payments, and audit records | Retain the minimum required evidence | Legal/financial retention overrides deletion |
| Caches | Invalidate user-scoped keys | Safe to repeat |

Each completed step is persisted on `PrivacyRequest`. Failed steps are recorded
with an error and can be retried through
`POST /api/users/me/privacy-requests/:requestId/retry`.
