# Payout authorization policy

Payout authorization is enforced at the route boundary by the shared policy
in `src/security/payoutPolicy.js`. Controllers do not read payout-specific
allowlists or make their own role decisions.

| Capability | Allowed principal | Additional requirements | Route |
| --- | --- | --- | --- |
| `payout.read.own` | mentor, admin | Owner match or admin boundary; the handler reads the authenticated educator's records | `GET /api/payouts/me/*` |
| `payout.initiate` | admin | active account and enabled, verified admin 2FA session | `POST /api/payouts/build` |
| `payout.execute` | admin | active account and enabled, verified admin 2FA session | `POST /api/payouts/:batchId/submit` |
| approval | none yet | Must receive a separate capability before a route is added | not exposed |

`PAYOUT_ADMIN_USER_IDS` is not an authorization decision for the API. It may
remain in deployment configuration while existing operators are migrated to
the role and 2FA policy; access is determined by the central capability map.

Every denied payout capability writes `authz.payout.denied` with the actor,
target (`Payout` and batch id when present), capability, denied decision,
reason, and request id. Audit writes are redaction-safe and non-blocking.

## Review and rollout checklist

- Add a capability and matrix test before adding a payout route.
- Keep read, initiate, approve, and execute capabilities distinct.
- Verify active-account/revocation and admin-2FA behavior for each mutating capability.
- Confirm denied requests contain actor, target, decision, and request id in the audit log.
- Roll out behind the existing authenticated route boundary; rollback is the
  previous application version, not a runtime allowlist override.
