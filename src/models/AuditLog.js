// models/AuditLog.js
//
// Append-only audit log for security- and financial-sensitive actions.
//
// RETENTION POLICY
// ─────────────────
// Financial rows (action prefix "payment.*", "payout.*") are retained
// indefinitely by default.  No TTL index is set.  Auth/wallet rows follow
// the same policy for now.  A future ops decision may archive rows older
// than N years to cold storage; update this comment and add an index at
// that time — do NOT add auto-expiry to financial rows without an explicit
// compliance sign-off.
import mongoose from "mongoose";

// ── Action enum ────────────────────────────────────────────────────────────
// New categories should be added here (and mirrored in auditService.js)
// before instrumenting new controllers.
export const AUDIT_ACTIONS = Object.freeze({
  // Auth
  AUTH_REGISTER_SUCCESS: "auth.register.success",
  AUTH_REGISTER_FAILURE: "auth.register.failure",
  AUTH_LOGIN_SUCCESS:    "auth.login.success",
  AUTH_LOGIN_FAILURE:    "auth.login.failure",
  AUTH_ACCOUNT_LOCKED:   "auth.account_locked",
  AUTH_LOGOUT:           "auth.logout",
  AUTH_PASSWORD_RESET_REQUEST:  "auth.password_reset.request",
  AUTH_PASSWORD_RESET_COMPLETE: "auth.password_reset.complete",
  AUTH_PASSWORD_CHANGE:         "auth.password_change",

  // 2FA
  AUTH_2FA_SETUP_INITIATED: "auth.2fa.setup_initiated",
  AUTH_2FA_ENABLE_SUCCESS:  "auth.2fa.enable.success",
  AUTH_2FA_ENABLE_FAILURE:  "auth.2fa.enable.failure",
  AUTH_2FA_LOGIN_CHALLENGE: "auth.2fa.login.challenge",
  AUTH_2FA_LOGIN_SUCCESS:   "auth.2fa.login.success",
  AUTH_2FA_LOGIN_FAILURE:   "auth.2fa.login.failure",
  AUTH_2FA_DISABLE_SUCCESS: "auth.2fa.disable.success",
  AUTH_2FA_DISABLE_FAILURE: "auth.2fa.disable.failure",
  AUTH_2FA_RECOVERY_USED:   "auth.2fa.recovery_used",

  // Wallet
  WALLET_CONNECT_SUCCESS:   "wallet.connect.success",
  WALLET_CONNECT_FAILURE:   "wallet.connect.failure",
  WALLET_DISCONNECT:        "wallet.disconnect",
  WALLET_REASSIGN_ATTEMPT:  "wallet.reassign.attempt",

  // Payments
  PAYMENT_INITIALIZE:       "payment.initialize",
  PAYMENT_SUBMIT_CONFIRMED: "payment.submit.confirmed",
  PAYMENT_SUBMIT_FAILED:    "payment.submit.failed",
  PAYMENT_CANCEL:           "payment.cancel",

  // Entitlements (access grants)
  ENTITLEMENT_GRANT: "entitlement.grant",

  // Authorization
  AUTHZ_OWNERSHIP_DENIED: "authz.ownership.denied",

  // Service-to-service auth (dnb-ai)
  SERVICE_AUTH_DENIED: "service_auth.denied",

  // Extension points — to be instrumented with issue #20 / #28
  PAYOUT_BATCH_INITIATED: "payout.batch.initiated",
  PAYOUT_BATCH_CONFIRMED: "payout.batch.confirmed",
  ROLE_CHANGE:            "role.change",

  // Educator verification pipeline (issue #92)
  EDUCATOR_VERIFY_SUBMIT:   "educator_verify.submit",
  EDUCATOR_VERIFY_RESUBMIT: "educator_verify.resubmit",
  EDUCATOR_VERIFY_APPROVE:  "educator_verify.approve",
  EDUCATOR_VERIFY_REJECT:   "educator_verify.reject",

  // Outbound webhooks (issue #45)
  WEBHOOK_ENDPOINT_CREATED:  "webhook.endpoint.created",
  WEBHOOK_ENDPOINT_UPDATED:  "webhook.endpoint.updated",
  WEBHOOK_ENDPOINT_DELETED:  "webhook.endpoint.deleted",
  WEBHOOK_ENDPOINT_DISABLED: "webhook.endpoint.disabled",
  WEBHOOK_SECRET_ROTATED:    "webhook.secret.rotated",
  WEBHOOK_DELIVERY_REDELIVERED: "webhook.delivery.redelivered",
  WEBHOOK_PING:              "webhook.ping",

  // Bulk notifications (issue #123)
  NOTIFICATION_BULK_SENT:    "notification.bulk_sent",
});

const ACTION_VALUES = Object.values(AUDIT_ACTIONS);

// ── Schema ─────────────────────────────────────────────────────────────────
const auditLogSchema = new mongoose.Schema(
  {
    /** The security/financial action that occurred. */
    action: {
      type: String,
      enum: ACTION_VALUES,
      required: [true, "action is required"],
    },

    /** The authenticated user who performed the action.
     *  Null for pre-authentication failures (e.g. login with unknown email). */
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /** Client IP address at the time of the action. */
    actorIp: {
      type: String,
      default: null,
    },

    /** Raw User-Agent string. */
    actorUserAgent: {
      type: String,
      default: null,
    },

    /** The kind of resource affected (e.g. "User", "Transaction", "Wallet"). */
    targetType: {
      type: String,
      default: null,
    },

    /**
     * The identifier of the affected resource (Mongo ObjectId as string,
     * email address, public key, etc.).
     */
    targetId: {
      type: String,
      default: null,
    },

    /** Whether the action succeeded or failed. */
    status: {
      type: String,
      enum: ["success", "failure"],
      required: [true, "status is required"],
    },

    /**
     * Structured context for the event.  Only an explicit allowlist of keys
     * is persisted (enforced in auditService.js) — no secrets, passwords,
     * tokens, or full wallet balances reach this field.
     */
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },

    /** Correlates to the X-Request-Id header / req.id set in app.js. */
    requestId: {
      type: String,
      default: null,
    },
  },
  {
    // Only createdAt is meaningful; updatedAt would imply mutability.
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    // Collection name is explicit so it never clashes with any future model.
    collection: "auditlogs",
  }
);

// ── Indexes ────────────────────────────────────────────────────────────────
auditLogSchema.index({ actor: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, targetId: 1 });

// ── Append-only enforcement ─────────────────────────────────────────────────
// These hooks ensure no document can be mutated or deleted at the model
// layer regardless of how the model is imported.

const MUTATION_ERROR =
  "AuditLog is append-only: update and delete operations are forbidden.";

// Block save() on existing documents
auditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error(MUTATION_ERROR));
  }
  next();
});

// Block query-based updates
for (const hook of [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "replaceOne",
]) {
  auditLogSchema.pre(hook, function (next) {
    next(new Error(MUTATION_ERROR));
  });
}

// Block query-based deletes
for (const hook of ["deleteOne", "deleteMany", "findOneAndDelete", "findByIdAndDelete"]) {
  auditLogSchema.pre(hook, function (next) {
    next(new Error(MUTATION_ERROR));
  });
}

export default mongoose.model("AuditLog", auditLogSchema);
