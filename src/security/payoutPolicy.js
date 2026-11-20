import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { recordAudit } from "../services/audit/auditService.js";

/**
 * Payout capabilities are deliberately separate so a future approval route
 * cannot accidentally inherit the permissions for building or executing a
 * batch.
 */
export const PAYOUT_CAPABILITIES = Object.freeze({
  READ_OWN: "payout.read.own",
  INITIATE: "payout.initiate",
  EXECUTE: "payout.execute",
});

export const isPayoutOwnerOrAdmin = (user, ownerId) =>
  user?.role === "admin" || String(user?._id) === String(ownerId);

const ROLE_POLICY = Object.freeze({
  [PAYOUT_CAPABILITIES.READ_OWN]: new Set(["mentor", "admin"]),
  [PAYOUT_CAPABILITIES.INITIATE]: new Set(["admin"]),
  [PAYOUT_CAPABILITIES.EXECUTE]: new Set(["admin"]),
});

const requiresVerifiedAdminSession = (user, capability, is2FAVerified) =>
  user?.role === "admin" &&
  capability !== PAYOUT_CAPABILITIES.READ_OWN &&
  (!user.twoFactor?.enabled || is2FAVerified !== true);

/**
 * Return a decision without touching Express or the database. Keeping this
 * pure makes the role, revocation, and 2FA matrix straightforward to test.
 */
export const decidePayoutAccess = ({ user, capability, is2FAVerified, ownerId }) => {
  if (!user?._id) return { allowed: false, reason: "not_authenticated" };
  if (user.isActive === false) return { allowed: false, reason: "account_revoked" };

  const roles = ROLE_POLICY[capability];
  if (!roles) return { allowed: false, reason: "unknown_capability" };
  if (!roles.has(user.role)) return { allowed: false, reason: "role_not_permitted" };
  if (
    capability === PAYOUT_CAPABILITIES.READ_OWN &&
    ownerId !== undefined &&
    !isPayoutOwnerOrAdmin(user, ownerId)
  ) {
    return { allowed: false, reason: "not_owner" };
  }
  if (requiresVerifiedAdminSession(user, capability, is2FAVerified)) {
    return { allowed: false, reason: "admin_2fa_required" };
  }
  return { allowed: true, reason: "allowed" };
};

const targetIdFromRequest = (req) =>
  req.params?.batchId || req.body?.batchId || "payout";

/**
 * Express guard for payout capabilities. Every denial is recorded with the
 * authenticated actor, target, decision, and request id from `req`.
 */
export const authorizePayout = (capability) => (req, res, next) => {
  const decision = decidePayoutAccess({
    user: req.user,
    capability,
    is2FAVerified: req.is2FAVerified,
  });

  if (!decision.allowed) {
    recordAudit({
      action: AUDIT_ACTIONS.AUTHZ_PAYOUT_DENIED,
      actor: req.user?._id || null,
      req,
      targetType: "Payout",
      targetId: targetIdFromRequest(req),
      status: "failure",
      metadata: {
        capability,
        decision: "denied",
        reason: decision.reason,
        role: req.user?.role,
      },
    });

    return res.status(req.user ? 403 : 401).json({
      success: false,
      message: req.user
        ? "Forbidden: insufficient payout permissions"
        : "Not authenticated",
    });
  }

  next();
};
