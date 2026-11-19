# CSRF and browser-session boundaries

## Authentication classes

- Browser sessions use the refreshToken HttpOnly cookie, scoped to
  /api/auth/refresh. The matching readable csrfToken cookie is scoped to the
  same path. The browser sends its value in X-CSRF-Token.
- Mobile and API clients use the Authorization: Bearer access-token header.
  They do not rely on cookies and therefore are not subject to the
  cookie-session CSRF check.
- Service-to-service routes use their route-specific signed-request
  authentication. They must not use browser cookies.

## Enforced policy

Every state-changing request carrying the refresh-token cookie must include:

1. An Origin matching CORS_ALLOWED_ORIGINS, or a matching Referer when
   the browser does not send Origin.
2. A csrfToken cookie and an identical X-CSRF-Token header.
3. A non-null origin. Wildcard origins are never accepted with credentials.

GET, HEAD, and OPTIONS are safe methods. CORS preflight permits the
X-CSRF-Token header, while the actual mutation still requires the token.
Missing or mismatched checks return 403 without invoking the route handler.

Refresh cookies are HttpOnly, Secure in production, and SameSite=None in
production for the explicitly allowlisted cross-origin frontend. The CSRF
cookie is readable only so same-origin browser code can copy it to the
header; it is not an authentication credential.

## Configuration and rollout

Set CORS_ALLOWED_ORIGINS to a comma-separated exact-origin allowlist before
deploying a new frontend. During rollout, monitor CSRF_ORIGIN_REJECTED and
CSRF_TOKEN_REQUIRED responses and update the client to send the header.
Do not weaken the check to permit *, null, arbitrary regexes, or broad
subdomains.

If rollback is required, roll back the application release and revoke sessions
issued during the affected window. Investigate rejected-origin spikes as
possible cross-site probes, and rotate refresh-token families after a
confirmed CSRF incident.
