import WebhookEndpoint from "../models/WebhookEndpoint.js";
import WebhookDelivery from "../models/WebhookDelivery.js";
import { validateEndpointUrl } from "../utils/ssrfGuard.js";
import { emitEvent, EVENT_TYPES } from "../services/webhooks/webhookService.js";
import logger from "../config/logger.js";

/**
 * Require admin role. Mirrors the payout admin pattern (allowlist-based)
 * pending a centralized RBAC system.
 */
function requireAdmin(req, res) {
  if (!req.user || req.user.role !== "admin") {
    res.status(403).json({
      success: false,
      message: "Forbidden: Admin access required",
    });
    return false;
  }
  return true;
}

/**
 * List webhook endpoints for the authenticated user (or all for admins).
 * GET /api/webhooks
 */
export const listEndpoints = async (req, res) => {
  try {
    const query = req.user.role === "admin"
      ? {}
      : { owner: req.user._id };

    const endpoints = await WebhookEndpoint.find(query).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: endpoints.length,
      endpoints,
    });
  } catch (error) {
    logger.error({ err: error }, "List webhook endpoints error");
    res.status(500).json({ success: false, message: "Failed to list endpoints" });
  }
};

/**
 * Create a webhook endpoint.
 * The raw secret is returned only in this response.
 * POST /api/webhooks
 */
export const createEndpoint = async (req, res) => {
  try {
    const { url, events, description } = req.body;

    if (!url || !events || !Array.isArray(events) || events.length === 0) {
      return res.status(400).json({
        success: false,
        message: "url and events (array) are required",
      });
    }

    // Validate event types
    const invalidEvents = events.filter(
      (e) => e !== "*" && !EVENT_TYPES.includes(e)
    );
    if (invalidEvents.length > 0) {
      return res.status(400).json({
        success: false,
        message: `Invalid event types: ${invalidEvents.join(", ")}`,
        validTypes: EVENT_TYPES,
      });
    }

    // SSRF check
    const ssrf = await validateEndpointUrl(url);
    if (!ssrf.valid) {
      return res.status(400).json({
        success: false,
        message: ssrf.error,
      });
    }

    const { raw, hashed } = WebhookEndpoint.generateSecret();

    const endpoint = await WebhookEndpoint.create({
      url,
      secret: hashed,
      events,
      description: description || "",
      owner: req.user._id,
    });

    logger.info({ endpointId: endpoint._id, url }, "Webhook endpoint created");

    // Return the raw secret — this is the only time it's visible
    res.status(201).json({
      success: true,
      message: "Endpoint created. Save the secret — it will not be shown again.",
      endpoint: {
        _id: endpoint._id,
        url: endpoint.url,
        events: endpoint.events,
        description: endpoint.description,
        isActive: endpoint.isActive,
        createdAt: endpoint.createdAt,
      },
      secret: raw,
    });
  } catch (error) {
    logger.error({ err: error }, "Create webhook endpoint error");
    res.status(500).json({ success: false, message: "Failed to create endpoint" });
  }
};

/**
 * Get a single endpoint by ID.
 * GET /api/webhooks/:id
 */
export const getEndpoint = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    // Non-admins can only view their own
    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    res.status(200).json({ success: true, endpoint });
  } catch (error) {
    logger.error({ err: error }, "Get webhook endpoint error");
    res.status(500).json({ success: false, message: "Failed to get endpoint" });
  }
};

/**
 * Update an endpoint (URL, events, description, isActive).
 * PUT /api/webhooks/:id
 */
export const updateEndpoint = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { url, events, description, isActive } = req.body;

    if (url !== undefined) {
      const ssrf = await validateEndpointUrl(url);
      if (!ssrf.valid) {
        return res.status(400).json({ success: false, message: ssrf.error });
      }
      endpoint.url = url;
    }

    if (events !== undefined) {
      if (!Array.isArray(events) || events.length === 0) {
        return res.status(400).json({
          success: false,
          message: "events must be a non-empty array",
        });
      }
      const invalidEvents = events.filter(
        (e) => e !== "*" && !EVENT_TYPES.includes(e)
      );
      if (invalidEvents.length > 0) {
        return res.status(400).json({
          success: false,
          message: `Invalid event types: ${invalidEvents.join(", ")}`,
        });
      }
      endpoint.events = events;
    }

    if (description !== undefined) endpoint.description = description;
    if (isActive !== undefined) {
      endpoint.isActive = isActive;
      if (isActive) {
        endpoint.disabledAt = undefined;
        endpoint.disabledReason = undefined;
        endpoint.consecutiveFailures = 0;
      }
    }

    await endpoint.save();

    res.status(200).json({ success: true, endpoint });
  } catch (error) {
    logger.error({ err: error }, "Update webhook endpoint error");
    res.status(500).json({ success: false, message: "Failed to update endpoint" });
  }
};

/**
 * Delete an endpoint and its pending deliveries.
 * DELETE /api/webhooks/:id
 */
export const deleteEndpoint = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    await WebhookDelivery.deleteMany({ endpoint: endpoint._id });
    await endpoint.deleteOne();

    res.status(200).json({ success: true, message: "Endpoint deleted" });
  } catch (error) {
    logger.error({ err: error }, "Delete webhook endpoint error");
    res.status(500).json({ success: false, message: "Failed to delete endpoint" });
  }
};

/**
 * Rotate the secret for an endpoint. Returns the new raw secret once.
 * POST /api/webhooks/:id/rotate-secret
 */
export const rotateSecret = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id).select("+secret");
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { raw, hashed } = WebhookEndpoint.generateSecret();
    endpoint.secret = hashed;
    await endpoint.save();

    res.status(200).json({
      success: true,
      message: "Secret rotated. Save the new secret — it will not be shown again.",
      secret: raw,
    });
  } catch (error) {
    logger.error({ err: error }, "Rotate webhook secret error");
    res.status(500).json({ success: false, message: "Failed to rotate secret" });
  }
};

/**
 * List deliveries for an endpoint (paginated, filterable by status).
 * GET /api/webhooks/:id/deliveries
 */
export const listDeliveries = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const { status, page = 1, limit = 20 } = req.query;
    const query = { endpoint: endpoint._id };
    if (status) query.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [deliveries, total] = await Promise.all([
      WebhookDelivery.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      WebhookDelivery.countDocuments(query),
    ]);

    res.status(200).json({
      success: true,
      deliveries,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    logger.error({ err: error }, "List webhook deliveries error");
    res.status(500).json({ success: false, message: "Failed to list deliveries" });
  }
};

/**
 * Redeliver a dead delivery.
 * POST /api/webhooks/:id/deliveries/:deliveryId/redeliver
 */
export const redeliver = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    const delivery = await WebhookDelivery.findOne({
      _id: req.params.deliveryId,
      endpoint: endpoint._id,
    });

    if (!delivery) {
      return res.status(404).json({ success: false, message: "Delivery not found" });
    }

    if (delivery.status !== "dead") {
      return res.status(400).json({
        success: false,
        message: "Only dead deliveries can be redelivered",
      });
    }

    delivery.status = "pending";
    delivery.nextAttemptAt = new Date();
    await delivery.save();

    res.status(200).json({
      success: true,
      message: "Delivery queued for redelivery",
      delivery,
    });
  } catch (error) {
    logger.error({ err: error }, "Redeliver webhook error");
    res.status(500).json({ success: false, message: "Failed to redeliver" });
  }
};

/**
 * Send a signed ping event to test endpoint integration.
 * POST /api/webhooks/:id/ping
 */
export const pingEndpoint = async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.findById(req.params.id);
    if (!endpoint) {
      return res.status(404).json({ success: false, message: "Endpoint not found" });
    }

    if (req.user.role !== "admin" && endpoint.owner.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Emit a ping event — will be delivered like any other event
    await emitEvent("payment.initialized", {
      ping: true,
      message: "DeenBridge webhook ping",
      endpointId: endpoint._id.toString(),
      sentAt: new Date().toISOString(),
    });

    res.status(200).json({
      success: true,
      message: "Ping event emitted",
    });
  } catch (error) {
    logger.error({ err: error }, "Ping webhook endpoint error");
    res.status(500).json({ success: false, message: "Failed to send ping" });
  }
};

/**
 * List available event types.
 * GET /api/webhooks/events
 */
export const listEventTypes = async (_req, res) => {
  res.status(200).json({
    success: true,
    events: EVENT_TYPES,
  });
};
