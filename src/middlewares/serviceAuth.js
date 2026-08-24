// middlewares/serviceAuth.js
//
// Service-to-service (S2S) authentication for the AI service (dnb-ai).
//
// Instead of a single static bearer token, callers sign each request with an
// HMAC-SHA256 signature over a canonical string, using a scoped key selected by
// `kid`. This gives us: replay protection (timestamp window), constant-time
// comparison (crypto.timingSafeEqual), per-key scopes, and zero-downtime key
// rotation via overlapping active `kid`s (see config/serviceKeys.js and
// docs/service-to-service-auth.md).
//
// ── Signing contract (the dnb-ai client MUST reproduce this exactly) ─────────
// Headers sent by the caller:
//   X-Service-Id      logical caller id (e.g. "dnb-ai")
//   X-Service-Key-Id  the key id (`kid`) selecting which secret to use
//   X-Timestamp       Unix time in SECONDS at signing (string)
//   X-Signature       lowercase hex HMAC-SHA256 of the canonical string
//
// Canonical string (LF-separated, no trailing newline):
//   METHOD \n PATH \n TIMESTAMP \n sha256hex(rawBody || "")
//
//   METHOD  = HTTP method, uppercased (e.g. "GET", "POST")
//   PATH    = request path exactly as sent, including any query string
//             (Express req.originalUrl — e.g. "/api/internal/ai/whoami")
//   TIMESTAMP = the same value sent in X-Timestamp
//   rawBody = the raw request body bytes ("" for bodyless GETs)
//
//   signature = HMAC_SHA256(key.secret, canonicalString) in lowercase hex
import crypto from "crypto";
import { APIError, catchAsync } from "./errorHandler.js";
import { getServiceKey } from "../config/serviceKeys.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

// Requests whose X-Timestamp is more than this many seconds away from the
// server clock (past OR future) are rejected as stale/replayed.
export const REPLAY_WINDOW_SECONDS = 300;

/** sha256 hex of a buffer/string. */
function sha256hex(input) {
  return crypto.createHash("sha256").update(input ?? "").digest("hex");
}

/**
 * Build the canonical string that is HMAC-signed. Exported so tests (and, by
 * mirror, the dnb-ai client) can reproduce the exact byte sequence.
 *
 * @param {object} p
 * @param {string} p.method     HTTP method (any case; uppercased here)
 * @param {string} p.path       request path incl. query (req.originalUrl)
 * @param {string|number} p.timestamp  Unix seconds
 * @param {Buffer|string} [p.rawBody]  raw request body bytes
 * @returns {string}
 */
export function buildCanonicalString({ method, path, timestamp, rawBody }) {
  return [
    String(method).toUpperCase(),
    path,
    String(timestamp),
    sha256hex(rawBody || ""),
  ].join("\n");
}

/** Constant-time equality on two hex strings, safe on length mismatch. */
function timingSafeEqualHex(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  // timingSafeEqual throws on unequal lengths, so guard first. Returning early
  // on a length mismatch is safe: signatures are fixed-length hex, so an
  // attacker learns nothing an equal-length compare wouldn't already leak.
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Guard a route with signed, scoped service-to-service auth.
 *
 * @param {object} opts
 * @param {string} opts.scope  the scope this route requires (e.g. "ai:read-content")
 * @returns Express middleware
 */
export function requireServiceAuth({ scope } = {}) {
  return catchAsync(async (req, _res, next) => {
    const serviceId = req.headers["x-service-id"];
    const kid = req.headers["x-service-key-id"];
    const timestamp = req.headers["x-timestamp"];
    const signature = req.headers["x-signature"];

    // Shared denial path: audit (fire-and-forget) then propagate an APIError.
    const deny = (reason, statusCode) => {
      recordAudit({
        action: AUDIT_ACTIONS.SERVICE_AUTH_DENIED,
        actor: null,
        req,
        targetType: "Service",
        targetId: serviceId || kid || "unknown",
        status: "failure",
        metadata: { reason, kid, scope },
      });
      return next(new APIError(reason, statusCode));
    };

    // 1. All four headers are required.
    if (!serviceId || !kid || !timestamp || !signature) {
      return deny("Missing service authentication headers", 401);
    }

    // 2. Reject stale / future timestamps (replay protection).
    const ts = Number(timestamp);
    if (!Number.isFinite(ts)) {
      return deny("Invalid service authentication timestamp", 401);
    }
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSeconds - ts) > REPLAY_WINDOW_SECONDS) {
      return deny("Service authentication timestamp outside replay window", 401);
    }

    // 3. Resolve the key by kid; unknown or retired (active:false) → 401.
    const key = getServiceKey(kid);
    if (!key || key.active !== true) {
      return deny("Unknown or retired service key", 401);
    }

    // 4. Recompute the signature and compare in constant time.
    const canonical = buildCanonicalString({
      method: req.method,
      path: req.originalUrl,
      timestamp,
      rawBody: req.rawBody,
    });
    const expected = crypto
      .createHmac("sha256", key.secret)
      .update(canonical)
      .digest("hex");
    if (!timingSafeEqualHex(signature, expected)) {
      return deny("Invalid service signature", 401);
    }

    // 5. Enforce scope (403 — authenticated but not permitted).
    if (!scope || !Array.isArray(key.scopes) || !key.scopes.includes(scope)) {
      return deny("Service key missing required scope", 403);
    }

    // 6. Success — attach the authenticated service context.
    req.service = { id: String(serviceId), kid, scopes: key.scopes };
    return next();
  });
}

export default requireServiceAuth;
