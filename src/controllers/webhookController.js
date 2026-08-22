// controllers/webhookController.js
//
// Management API for outbound webhook endpoints and their deliveries. All
// routes are admin-gated (see routes/webhookRoutes.js). The signing secret is
// returned ONLY in the create and rotate-secret responses; no read endpoint
// ever returns it.
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import WebhookEndpoint from "../models/WebhookEndpoint.js";
import WebhookDelivery from "../models/WebhookDelivery.js";
import { validateWebhookUrl, assertDeliverableUrl } from "../services/webhooks/urlGuard.js";
import { generateSecret, encryptSecret } from "../services/webhooks/webhookSecret.js";
import { emitEventToEndpoint, EVENT_TYPES } from "../services/webhooks/webhookService.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import logger from "../config/logger.js";

const DELIVERY_STATUSES = ["pending", "retrying", "delivered", "dead"];

// Validate a URL structurally, then (in production) resolve DNS to reject
// private targets. Throws APIError(400) on failure.
const validateUrlOrThrow = async (url) => {
  try {
    validateWebhookUrl(url);
  } catch (err) {
    throw new APIError(err.message, 400);
  }
  const guard = await assertDeliverableUrl(url);
  if (!guard.ok) {
    throw new APIError(`Webhook URL rejected: ${guard.reason}`, 400);
  }
};

const normalizeEvents = (events) => {
  if (events === undefined) return undefined;
  if (!Array.isArray(events) || events.length === 0) {
    throw new APIError("`events` must be a non-empty array of event types", 400);
  }
  const valid = new Set([...Object.values(EVENT_TYPES), "*"]);
  for (const e of events) {
    if (!valid.has(e)) {
      throw new APIError(`Unknown event type: ${e}`, 400);
    }
  }
  return events;
};

/**
 * POST /api/webhooks
 * Register a new endpoint. Returns the plaintext signing secret ONCE.
 */
export const createEndpoint = catchAsync(async (req, res) => {
  const { url, events, description } = req.body;

  if (!url) throw new APIError("`url` is required", 400);
  await validateUrlOrThrow(url);
  const normalizedEvents = normalizeEvents(events) || ["*"];

  const secret = generateSecret();
  const endpoint = await WebhookEndpoint.create({
    url,
    secretEncrypted: encryptSecret(secret),
    events: normalizedEvents,
    description,
    owner: req.user._id,
  });

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_ENDPOINT_CREATED,
    actor: req.user._id,
    req,
    targetType: "WebhookEndpoint",
    targetId: endpoint._id.toString(),
    status: "success",
    metadata: { endpointId: endpoint._id.toString(), url, events: normalizedEvents },
  });

  logger.info({ endpointId: endpoint._id.toString() }, "webhook: endpoint created");

  // Secret shown exactly once. endpoint.toJSON() strips secretEncrypted.
  res.status(201).json({
    success: true,
    message: "Webhook endpoint created. Store the secret now — it is shown only once.",
    endpoint,
    secret,
  });
});

/**
 * GET /api/webhooks
 * List the caller's endpoints (never includes the secret).
 */
export const listEndpoints = catchAsync(async (req, res) => {
  const endpoints = await WebhookEndpoint.find({ owner: req.user._id }).sort({
    createdAt: -1,
  });
  res.status(200).json({ success: true, endpoints });
});

const findOwnedEndpoint = async (id, ownerId) => {
  const endpoint = await WebhookEndpoint.findOne({ _id: id, owner: ownerId });
  if (!endpoint) throw new APIError("Webhook endpoint not found", 404);
  return endpoint;
};

/**
 * GET /api/webhooks/:id
 */
export const getEndpoint = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);
  res.status(200).json({ success: true, endpoint });
});

/**
 * PATCH /api/webhooks/:id
 * Update url / events / description / isActive. Re-enabling clears the
 * disabled markers. Never returns or rotates the secret.
 */
export const updateEndpoint = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);
  const { url, events, description, isActive } = req.body;

  if (url !== undefined) {
    await validateUrlOrThrow(url);
    endpoint.url = url;
  }
  if (events !== undefined) {
    endpoint.events = normalizeEvents(events);
  }
  if (description !== undefined) {
    endpoint.description = description;
  }
  if (isActive !== undefined) {
    endpoint.isActive = Boolean(isActive);
    if (isActive) {
      // Re-enable: reset failure state so it isn't immediately re-disabled.
      endpoint.consecutiveFailures = 0;
      endpoint.disabledAt = undefined;
      endpoint.disabledReason = undefined;
    }
  }

  await endpoint.save();

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_ENDPOINT_UPDATED,
    actor: req.user._id,
    req,
    targetType: "WebhookEndpoint",
    targetId: endpoint._id.toString(),
    status: "success",
    metadata: { endpointId: endpoint._id.toString() },
  });

  res.status(200).json({ success: true, endpoint });
});

/**
 * DELETE /api/webhooks/:id
 */
export const deleteEndpoint = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);
  await WebhookEndpoint.deleteOne({ _id: endpoint._id });

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_ENDPOINT_DELETED,
    actor: req.user._id,
    req,
    targetType: "WebhookEndpoint",
    targetId: endpoint._id.toString(),
    status: "success",
    metadata: { endpointId: endpoint._id.toString() },
  });

  res.status(200).json({ success: true, message: "Webhook endpoint deleted" });
});

/**
 * POST /api/webhooks/:id/rotate-secret
 * Generate a new signing secret and return it ONCE.
 */
export const rotateSecret = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);
  const secret = generateSecret();
  endpoint.secretEncrypted = encryptSecret(secret);
  await endpoint.save();

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_SECRET_ROTATED,
    actor: req.user._id,
    req,
    targetType: "WebhookEndpoint",
    targetId: endpoint._id.toString(),
    status: "success",
    metadata: { endpointId: endpoint._id.toString() },
  });

  res.status(200).json({
    success: true,
    message: "Secret rotated. Store the new secret now — it is shown only once.",
    secret,
  });
});

/**
 * GET /api/webhooks/:id/deliveries?status=&page=&limit=
 * Paginated, filterable delivery history for an endpoint.
 */
export const listDeliveries = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);

  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const query = { endpoint: endpoint._id };

  if (req.query.status) {
    if (!DELIVERY_STATUSES.includes(req.query.status)) {
      throw new APIError(`Invalid status filter: ${req.query.status}`, 400);
    }
    query.status = req.query.status;
  }

  const [deliveries, total] = await Promise.all([
    WebhookDelivery.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit),
    WebhookDelivery.countDocuments(query),
  ]);

  res.status(200).json({
    success: true,
    deliveries,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
});

/**
 * POST /api/webhooks/:id/deliveries/:deliveryId/redeliver
 * Requeue a delivery (typically a dead one) for immediate re-attempt.
 */
export const redeliver = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);
  const delivery = await WebhookDelivery.findOne({
    _id: req.params.deliveryId,
    endpoint: endpoint._id,
  });
  if (!delivery) throw new APIError("Delivery not found", 404);

  if (delivery.status === "delivered") {
    throw new APIError("Delivery already succeeded; nothing to redeliver", 400);
  }

  // Atomic status transition via $set — avoids full-document re-validation of
  // the Mixed `payload` field (Mongoose's required check trips on re-save) and
  // matches the worker's claim pattern.
  const requeued = await WebhookDelivery.findByIdAndUpdate(
    delivery._id,
    { $set: { status: "pending", nextAttemptAt: new Date() } },
    { new: true }
  );

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_DELIVERY_REDELIVERED,
    actor: req.user._id,
    req,
    targetType: "WebhookDelivery",
    targetId: delivery._id.toString(),
    status: "success",
    metadata: {
      endpointId: endpoint._id.toString(),
      deliveryId: delivery._id.toString(),
      eventType: delivery.eventType,
    },
  });

  res.status(200).json({ success: true, message: "Delivery requeued", delivery: requeued });
});

/**
 * POST /api/webhooks/:id/ping
 * Emit a signed `ping` event to this endpoint for integration testing.
 */
export const pingEndpoint = catchAsync(async (req, res) => {
  const endpoint = await findOwnedEndpoint(req.params.id, req.user._id);

  const { eventId, delivery } = await emitEventToEndpoint(
    endpoint._id,
    EVENT_TYPES.PING,
    { message: "ping", type: "ping" }
  );

  recordAudit({
    action: AUDIT_ACTIONS.WEBHOOK_PING,
    actor: req.user._id,
    req,
    targetType: "WebhookEndpoint",
    targetId: endpoint._id.toString(),
    status: delivery ? "success" : "failure",
    metadata: { endpointId: endpoint._id.toString(), eventType: "ping" },
  });

  res.status(202).json({
    success: true,
    message: "Ping queued for delivery",
    eventId,
    deliveryId: delivery?._id,
  });
});
