// services/webhooks/signing.js
//
// HMAC-SHA256 request signing for outbound webhooks (Stripe/Svix-style).
//
// Canonical string that is signed:
//
//     `${timestamp}.${rawBody}`
//
// where `timestamp` is unix seconds (as a string) and `rawBody` is the EXACT
// serialized bytes that are POSTed. Serialize the body ONCE, sign those bytes,
// and send the same buffer — re-serializing JSON can reorder keys and break
// verification on the consumer side.
import crypto from "crypto";

export const SIGNATURE_VERSION = "v1";

// Consumers must reject deliveries whose timestamp is older than this to
// blunt replay attacks. Documented in docs/webhooks.md.
export const DEFAULT_TOLERANCE_SEC = 300; // 5 minutes

export const WEBHOOK_HEADERS = Object.freeze({
  EVENT: "X-DeenBridge-Event",
  EVENT_ID: "X-DeenBridge-Event-Id",
  TIMESTAMP: "X-DeenBridge-Timestamp",
  SIGNATURE: "X-DeenBridge-Signature",
});

/**
 * Build the canonical string that gets HMAC'd.
 * @param {string|number} timestamp unix seconds
 * @param {string} rawBody the exact serialized body being sent
 */
export const buildSignatureBase = (timestamp, rawBody) =>
  `${timestamp}.${rawBody}`;

/**
 * Produce the value for the X-DeenBridge-Signature header:
 * `v1=<hex hmac-sha256(secret, `${timestamp}.${rawBody}`)>`
 */
export const signPayload = ({ secret, timestamp, rawBody }) => {
  const digest = crypto
    .createHmac("sha256", secret)
    .update(buildSignatureBase(timestamp, rawBody))
    .digest("hex");
  return `${SIGNATURE_VERSION}=${digest}`;
};

/**
 * Constant-time verification of a signature header. This mirrors the snippet
 * documented for consumers in docs/webhooks.md and is used by the test suite.
 *
 * @returns {boolean} true only if the version matches, the timestamp is fresh,
 *                    and the HMAC matches in constant time.
 */
export const verifySignature = ({
  secret,
  timestamp,
  rawBody,
  signatureHeader,
  toleranceSec = DEFAULT_TOLERANCE_SEC,
}) => {
  if (!signatureHeader || typeof signatureHeader !== "string") return false;

  const [version, provided] = signatureHeader.split("=");
  if (version !== SIGNATURE_VERSION || !provided) return false;

  // Reject stale timestamps (replay protection).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(buildSignatureBase(timestamp, rawBody))
    .digest("hex");

  // timingSafeEqual throws if the buffers differ in length, so guard first.
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(provided, "hex");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};
