import crypto from "crypto";
import WebhookEndpoint from "../../models/WebhookEndpoint.js";
import WebhookDelivery from "../../models/WebhookDelivery.js";
import logger from "../../config/logger.js";

export const WEBHOOK_API_VERSION = "2025-01-01";

/**
 * Supported event types.
 * Consumers subscribe to one or more of these, or use "*" for all.
 */
export const EVENT_TYPES = [
  "payment.initialized",
  "payment.confirmed",
  "payment.failed",
  "payment.expired",
  "course.enrolled",
  "wallet.connected",
  "wallet.disconnected",
];

/**
 * Build the deterministic event payload.
 * Secrets, passwords, full user documents, and internal fields are excluded.
 */
function buildPayload(eventType, data) {
  return {
    apiVersion: WEBHOOK_API_VERSION,
    eventId: crypto.randomUUID(),
    eventType,
    createdAt: new Date().toISOString(),
    data,
  };
}

/**
 * Compute HMAC-SHA256 signature for a webhook payload.
 * Format: v1=<hex>
 *
 * @param {string} secret - The raw webhook secret
 * @param {string} timestamp - ISO timestamp used in the signed message
 * @param {string} rawBody - The exact serialized body bytes
 * @returns {string} The signature header value
 */
export function computeSignature(secret, timestamp, rawBody) {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(`${timestamp}.${rawBody}`);
  return `v1=${hmac.digest("hex")}`;
}

/**
 * Verify an HMAC-SHA256 signature.
 *
 * @param {string} secret - The raw webhook secret
 * @param {string} timestamp - The timestamp from the request
 * @param {string} rawBody - The raw body bytes
 * @param {string} signature - The signature header value (v1=<hex>)
 * @returns {boolean}
 */
export function verifySignature(secret, timestamp, rawBody, signature) {
  if (!signature || !signature.startsWith("v1=")) return false;

  const expected = computeSignature(secret, timestamp, rawBody);
  const sigBuf = Buffer.from(signature);
  const expectedBuf = Buffer.from(expected);

  if (sigBuf.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(sigBuf, expectedBuf);
}

/**
 * Emit a webhook event.
 *
 * Fire-and-forget: persists WebhookDelivery rows for all matching active
 * endpoints and returns. Never throws — delivery failures are logged and
 * tracked on the delivery record.
 *
 * Must be called AFTER the originating DB transaction commits.
 *
 * @param {string} eventType - One of EVENT_TYPES
 * @param {object} data - Event-specific payload (allowlisted fields only)
 */
export async function emitEvent(eventType, data) {
  if (!EVENT_TYPES.includes(eventType)) {
    logger.warn({ eventType }, "Unknown webhook event type");
    return;
  }

  try {
    const endpoints = await WebhookEndpoint.find({
      isActive: true,
    });

    const subscribers = endpoints.filter((ep) => ep.isSubscribedTo(eventType));

    if (subscribers.length === 0) return;

    const payload = buildPayload(eventType, data);

    const deliveries = subscribers.map((ep) => ({
      endpoint: ep._id,
      eventId: payload.eventId,
      eventType,
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    }));

    await WebhookDelivery.insertMany(deliveries);

    logger.info(
      { eventType, eventId: payload.eventId, endpointCount: subscribers.length },
      "Webhook event emitted"
    );
  } catch (error) {
    logger.error({ err: error, eventType }, "Failed to emit webhook event");
  }
}

/**
 * Build the headers for an outbound webhook delivery.
 */
export function buildDeliveryHeaders(secret, rawBody) {
  const timestamp = new Date().toISOString();
  const signature = computeSignature(secret, timestamp, rawBody);

  return {
    "Content-Type": "application/json",
    "X-DeenBridge-Event": undefined, // set per-delivery
    "X-DeenBridge-Timestamp": timestamp,
    "X-DeenBridge-Signature": signature,
  };
}

/**
 * Serialize a payload deterministically (sorted keys) to ensure
 * signature verification works on the receiving end.
 */
export function serializePayload(payload) {
  return JSON.stringify(payload, Object.keys(payload).sort());
}
