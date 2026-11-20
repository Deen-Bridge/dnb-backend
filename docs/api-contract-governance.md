# API contract governance

openapi.yaml is the reviewed source of truth for the versioned HTTP contract.
Every operation must have a unique operationId, an explicit response map,
authentication requirements, and documented pagination or idempotency behavior
where applicable.

Changes to a public response or request are classified as compatible,
deprecated, or breaking in the pull-request description. Breaking changes
must use a new versioned route or receive explicit maintainer approval.
Internal and admin routes are excluded from public client generation and must
declare their authorization requirement in the contract.

The API contract workflow runs on route/spec changes. It rejects duplicate
operation IDs and undocumented response maps before merge. Consumer-specific
contract tests should be added alongside client changes; the OpenAPI check is
not a substitute for authorization tests.
