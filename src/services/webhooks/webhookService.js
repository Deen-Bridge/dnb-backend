// services/webhooks/webhookService.js
//
// Typed event catalog and the fire-and-forget `emitEvent` used by controllers.
//
// CONTRACT: emitEvent MUST NEVER throw or reject into the request path. It is
// called AFTER the Mongo transaction commits (a rolled-back write emits
// nothing). It resolves matching active endpoints, persists one
// WebhookDelivery per endpoint (status `pending`, `nextAttemptAt = now`), and
// returns. The delivery worker does the actual HTTP work out of band. All
// errors are caught and logged so a webhook problem can never break a payment.
import crypto from "crypto";
import mongoose from "mongoose";
import WebhookEndpoint from "../../models/WebhookEndpoint.js";
import WebhookDelivery from "../../models/WebhookDelivery.js";
import logger from "../../config/logger.js";

// Bumped when the payload envelope shape changes so consumers can branch.
export const API_VERSION = process.env.WEBHOOK_API_VERSION || "2025-01-01";

// The full event catalog. `ping` is emitted only via the management API.
export const EVENT_TYPES = Object.freeze({
  PAYMENT_INITIALIZED: "payment.initialized",
  PAYMENT_CONFIRMED: "payment.confirmed",
  PAYMENT_FAILED: "payment.failed",
  PAYMENT_EXPIRED: "payment.expired",
  COURSE_ENROLLED: "course.enrolled",
  WALLET_CONNECTED: "wallet.connected",
  WALLET_DISCONNECTED: "wallet.disconnected",
  PING: "ping",
});

const EVENT_CATALOG = new Set(Object.values(EVENT_TYPES));

// Explicit allowlist of fields permitted inside `data`. Anything else (emails,
// password hashes, full user documents, secrets) is stripped before the
// envelope is persisted or sent. IDs, wallet public keys, amounts, tx hashes,
// and item references only.
const EVENT_DATA_ALLOWLIST = new Set([
  "transactionId",
  "type",
  "itemType",
  "itemId",
  "itemTitle",
  "amount",
  "currency",
  "network",
  "settlement",
  "stellarTxHash",
  "stellarLedger",
  "status",
  "failureReason",
  "buyerId",
  "creatorId",
  "buyerWallet",
  "creatorWallet",
  "publicKey",
  "courseId",
  "userId",
  "message",
]);

/**
 * Strip any key not on the allowlist. Never mutates the caller's object.
 */
export const sanitizeEventData = (data) => {
  if (!data || typeof data !== "object") return {};
  const safe = {};
  for (const key of Object.keys(data)) {
    if (EVENT_DATA_ALLOWLIST.has(key) && data[key] !== undefined) {
      safe[key] = data[key];
    }
  }
  return safe;
};

/**
 * Build the signed event envelope. Exposed for reuse/testing.
 */
export const buildEventEnvelope = (type, data) => ({
  eventId: crypto.randomUUID(),
  type,
  createdAt: new Date().toISOString(),
  apiVersion: API_VERSION,
  data: sanitizeEventData(data),
});

const buildPendingDelivery = (endpointId, envelope) => ({
  endpoint: endpointId,
  eventId: envelope.eventId,
  eventType: envelope.type,
  payload: envelope,
  status: "pending",
  attemptCount: 0,
  nextAttemptAt: new Date(),
});

/**
 * Emit an event to every active endpoint subscribed to it (explicitly or via
 * `["*"]`). Never rejects. Awaited after the txn commit; persists rows and returns while
 * the HTTP delivery happens out of band (worker). No-ops when the DB is down.
 *
 * @returns {Promise<{ eventId: string, deliveries: number }>}
 */
export const emitEvent = async (type, data = {}) => {
  try {
    if (!EVENT_CATALOG.has(type)) {
      logger.warn({ type }, "webhook: refusing to emit unknown event type");
      return { eventId: null, deliveries: 0 };
    }

    const envelope = buildEventEnvelope(type, data);

    // Skip persistence when the DB isn't connected (e.g. unit tests that mock
    // models without a live connection, or a DB outage) — mirrors the audit
    // service, so awaiting emitEvent after commit never hangs the request path.
    if (mongoose.connection.readyState !== 1) {
      return { eventId: envelope.eventId, deliveries: 0 };
    }

    const endpoints = await WebhookEndpoint.find({
      isActive: true,
      $or: [{ events: type }, { events: "*" }],
    }).select("_id");

    if (endpoints.length === 0) {
      return { eventId: envelope.eventId, deliveries: 0 };
    }

    const docs = endpoints.map((ep) => buildPendingDelivery(ep._id, envelope));
    await WebhookDelivery.insertMany(docs);

    logger.info(
      { eventId: envelope.eventId, type, deliveries: docs.length },
      "webhook: event emitted"
    );
    return { eventId: envelope.eventId, deliveries: docs.length };
  } catch (err) {
    // Emission must never surface to the request path.
    logger.error({ err, type }, "webhook: emitEvent failed");
    return { eventId: null, deliveries: 0 };
  }
};

/**
 * Emit an event to a single, specific endpoint (used by the `ping` action).
 * Also fire-and-forget-safe. Creates the delivery regardless of subscription
 * so an operator can test any endpoint.
 *
 * @returns {Promise<{ eventId: string|null, delivery: object|null }>}
 */
export const emitEventToEndpoint = async (endpointId, type, data = {}) => {
  try {
    if (!EVENT_CATALOG.has(type)) {
      logger.warn({ type }, "webhook: refusing to emit unknown event type");
      return { eventId: null, delivery: null };
    }
    const envelope = buildEventEnvelope(type, data);
    const delivery = await WebhookDelivery.create(
      buildPendingDelivery(endpointId, envelope)
    );
    return { eventId: envelope.eventId, delivery };
  } catch (err) {
    logger.error({ err, type, endpointId }, "webhook: emitEventToEndpoint failed");
    return { eventId: null, delivery: null };
  }
};
