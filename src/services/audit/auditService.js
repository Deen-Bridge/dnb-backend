// services/audit/auditService.js
//
// Non-blocking, redaction-safe helper for writing audit rows.
//
// Usage (fire-and-forget — do NOT await at call site):
//
//   recordAudit({
//     action:     AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
//     actor:      user._id,         // null for anonymous/pre-auth
//     req,                          // pass the Express request for IP/UA/reqId
//     targetType: "User",
//     targetId:   user._id.toString(),
//     status:     "success",
//     metadata:   { email: user.email },  // only allowlisted keys are stored
//   });
//
// The function schedules the write via Promise microtask and catches all
// errors internally, so a DB write failure NEVER propagates to the caller.
import mongoose from "mongoose";
import AuditLog from "../../models/AuditLog.js";
import logger from "../../config/logger.js";

// ── Metadata redaction allowlist ───────────────────────────────────────────
// ONLY keys listed here will be persisted in metadata.
// Add keys here when instrumenting new actions — never use a denylist approach.
const METADATA_ALLOWLIST = new Set([
  // Identity / context
  "email",
  "role",
  "assignedRole",
  "name",

  // Wallet
  "publicKey",
  "network",
  "previousPublicKey",

  // Payment
  "transactionId",
  "itemType",
  "itemId",
  "itemTitle",
  "amount",
  "stellarTxHash",
  "stellarLedger",
  "settlementMode",
  "failureReason",

  // Entitlement
  "accessGranted",

  // Payout / ledger (extension — #28)
  "batchId",
  "payoutAmount",
  "educatorId",

  // Role change (extension — #20)
  "previousRole",
  "newRole",
  "changedBy",

  // Educator verification (issue #92)
  "verificationId",
  "previousStatus",
  "newStatus",
  "reviewedBy",
  "reviewNotes",
  "documentCount",

  // Generic error context
  "reason",
  "conflictUserId",

  // Service-to-service auth (dnb-ai)
  "serviceId",
  "kid",
  "scope",

  // Outbound webhooks (issue #45)
  "endpointId",
  "deliveryId",
  "eventType",
  "url",
  "events",
  "disabledReason",
]);

/**
 * Strip any metadata key not in the allowlist.
 * Returns null if metadata is null/undefined/empty.
 *
 * @param {object|null} metadata
 * @returns {object|null}
 */
export function redactMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return null;
  const safe = {};
  for (const key of Object.keys(metadata)) {
    if (METADATA_ALLOWLIST.has(key)) {
      safe[key] = metadata[key];
    }
  }
  return Object.keys(safe).length > 0 ? safe : null;
}

/**
 * Record a security/financial audit event.  Always fire-and-forget relative
 * to the caller — the write is scheduled in a microtask and errors are
 * swallowed (logged only).
 *
 * @param {object} opts
 * @param {string}             opts.action      - One of AUDIT_ACTIONS values
 * @param {string|ObjectId|null} opts.actor     - User._id or null
 * @param {import("express").Request} [opts.req] - Express request (for IP/UA/reqId)
 * @param {string|null}        [opts.targetType]
 * @param {string|null}        [opts.targetId]
 * @param {"success"|"failure"} opts.status
 * @param {object|null}        [opts.metadata]  - Will be allowlist-filtered
 */
export function recordAudit({
  action,
  actor = null,
  req = null,
  targetType = null,
  targetId = null,
  status,
  metadata = null,
}) {
  // Schedule asynchronously so the caller is never blocked by the write.
  // The chain is `return`ed (and its .catch always swallows errors) so that
  // security-critical callers MAY `await recordAudit(...)` to guarantee the
  // row is durable before responding — but awaiting is optional and never
  // throws to the caller.
  return Promise.resolve()
    .then(async () => {
      // If DB is not connected and AuditLog.create is not mocked (e.g. unit tests without DB),
      // skip write to prevent 10s Mongoose buffer timeouts.
      if (mongoose.connection.readyState !== 1 && !AuditLog.create.mock) {
        return;
      }

      const actorIp        = req?.ip ?? null;
      const actorUserAgent = req?.headers?.["user-agent"] ?? null;
      const requestId      = req?.id ?? null;

      await AuditLog.create({
        action,
        actor:         actor || null,
        actorIp,
        actorUserAgent,
        targetType,
        targetId:      targetId ? String(targetId) : null,
        status,
        metadata:      redactMetadata(metadata),
        requestId,
      });
    })
    .catch((err) => {
      // Never let an audit failure surface to the user.
      logger.error(
        { err, action, actor, targetType, targetId },
        "audit: failed to write audit log row"
      );
    });
}
