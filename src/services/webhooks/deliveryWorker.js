import axios from "axios";
import crypto from "crypto";
import WebhookEndpoint from "../../models/WebhookEndpoint.js";
import WebhookDelivery from "../../models/WebhookDelivery.js";
import { computeSignature, serializePayload } from "./webhookService.js";
import logger from "../../config/logger.js";

const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 6;
const MAX_CONSECUTIVE_FAILURES_TO_DISABLE = 20;

/**
 * Exponential backoff schedule with jitter.
 * Attempt 0 = immediate (pending), then 1m, 5m, 30m, 2h, 12h.
 */
const BACKOFF_SCHEDULE_MS = [
  0,           // initial attempt
  60_000,      // 1 minute
  300_000,     // 5 minutes
  1_800_000,   // 30 minutes
  7_200_000,   // 2 hours
  43_200_000,  // 12 hours
];

function getBackoffMs(attemptIndex) {
  const base = BACKOFF_SCHEDULE_MS[Math.min(attemptIndex, BACKOFF_SCHEDULE_MS.length - 1)];
  // Add jitter: ±20% of the base delay
  const jitter = base * 0.2 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(base + jitter));
}

/**
 * Deliver a single webhook delivery.
 * Returns true on success, false on failure.
 */
async function deliverWebhook(delivery) {
  const endpoint = await WebhookEndpoint.findById(delivery.endpoint).select("+secret");
  if (!endpoint || !endpoint.isActive) {
    delivery.status = "dead";
    delivery.attempts.push({
      at: new Date(),
      error: "Endpoint not found or inactive",
    });
    await delivery.save();
    return false;
  }

  const rawBody = serializePayload(delivery.payload);
  const timestamp = new Date().toISOString();
  const signature = computeSignature(endpoint.secret, timestamp, rawBody);

  const headers = {
    "Content-Type": "application/json",
    "X-DeenBridge-Event": delivery.eventType,
    "X-DeenBridge-Event-Id": delivery.eventId,
    "X-DeenBridge-Timestamp": timestamp,
    "X-DeenBridge-Signature": signature,
  };

  const startTime = Date.now();

  try {
    const response = await axios.post(endpoint.url, rawBody, {
      headers,
      timeout: DELIVERY_TIMEOUT_MS,
      maxRedirects: 0,
      validateStatus: () => true, // don't throw for non-2xx
    });

    const durationMs = Date.now() - startTime;
    const is2xx = response.status >= 200 && response.status < 300;

    const attemptRecord = {
      at: new Date(),
      statusCode: response.status,
      durationMs,
      responseBody: typeof response.data === "string"
        ? response.data.slice(0, 4096)
        : JSON.stringify(response.data).slice(0, 4096),
    };

    delivery.attempts.push(attemptRecord);
    delivery.lastAttemptAt = new Date();
    endpoint.totalDeliveries += 1;

    if (is2xx) {
      delivery.status = "delivered";
      delivery.deliveredAt = new Date();
      endpoint.consecutiveFailures = 0;
      await delivery.save();
      await endpoint.save();
      return true;
    }

    // Non-2xx: schedule retry
    delivery.status = "retrying";
    const nextAttempt = delivery.attempts.length;
    if (nextAttempt >= MAX_ATTEMPTS) {
      delivery.status = "dead";
    }
    delivery.nextAttemptAt = new Date(Date.now() + getBackoffMs(nextAttempt));

    endpoint.totalFailures += 1;
    endpoint.consecutiveFailures += 1;

    await delivery.save();
    await endpoint.save();

    // Auto-disable endpoint after sustained failures
    if (endpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_TO_DISABLE) {
      endpoint.isActive = false;
      endpoint.disabledAt = new Date();
      endpoint.disabledReason = `Auto-disabled after ${endpoint.consecutiveFailures} consecutive delivery failures`;
      await endpoint.save();
      logger.warn(
        { endpointId: endpoint._id, consecutiveFailures: endpoint.consecutiveFailures },
        "Webhook endpoint auto-disabled due to sustained failures"
      );
    }

    return false;
  } catch (error) {
    const durationMs = Date.now() - startTime;

    delivery.attempts.push({
      at: new Date(),
      error: error.message?.slice(0, 512) || "Unknown delivery error",
      durationMs,
    });
    delivery.lastAttemptAt = new Date();

    const nextAttempt = delivery.attempts.length;
    delivery.status = nextAttempt >= MAX_ATTEMPTS ? "dead" : "retrying";
    if (delivery.status === "retrying") {
      delivery.nextAttemptAt = new Date(Date.now() + getBackoffMs(nextAttempt));
    }

    endpoint.totalFailures += 1;
    endpoint.consecutiveFailures += 1;
    endpoint.totalDeliveries += 1;

    await delivery.save();
    await endpoint.save();

    if (endpoint.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES_TO_DISABLE) {
      endpoint.isActive = false;
      endpoint.disabledAt = new Date();
      endpoint.disabledReason = `Auto-disabled after ${endpoint.consecutiveFailures} consecutive delivery failures`;
      await endpoint.save();
      logger.warn(
        { endpointId: endpoint._id, consecutiveFailures: endpoint.consecutiveFailures },
        "Webhook endpoint auto-disabled due to sustained failures"
      );
    }

    return false;
  }
}

/**
 * Process due deliveries with atomic claim.
 * Uses findOneAndUpdate to claim a delivery so concurrent worker
 * instances don't double-send.
 *
 * @param {number} [batchSize=10] - Max deliveries to process per tick
 * @returns {Promise<number>} Number of deliveries processed
 */
export async function processDeliveries(batchSize = 10) {
  let processed = 0;

  for (let i = 0; i < batchSize; i++) {
    // Atomically claim the next due delivery
    const delivery = await WebhookDelivery.findOneAndUpdate(
      {
        status: { $in: ["pending", "retrying"] },
        nextAttemptAt: { $lte: new Date() },
      },
      {
        $set: { status: "processing" }, // mark as in-flight
      },
      {
        new: true,
        sort: { nextAttemptAt: 1 },
      }
    );

    if (!delivery) break;

    await deliverWebhook(delivery);
    processed += 1;
  }

  return processed;
}

/**
 * Start the delivery worker loop.
 * Runs every `intervalMs` and processes due deliveries.
 *
 * @param {number} [intervalMs=15000] - Polling interval in milliseconds
 * @returns {{ stop: () => void }} Control handle to stop the worker
 */
export function startDeliveryWorker(intervalMs = 15_000) {
  let running = true;
  let timer = null;

  const tick = async () => {
    if (!running) return;
    try {
      const count = await processDeliveries();
      if (count > 0) {
        logger.info({ count }, "Webhook delivery batch processed");
      }
    } catch (error) {
      logger.error({ err: error }, "Webhook delivery worker error");
    }
    if (running) {
      timer = setTimeout(tick, intervalMs);
    }
  };

  timer = setTimeout(tick, intervalMs);
  logger.info({ intervalMs }, "Webhook delivery worker started");

  return {
    stop() {
      running = false;
      if (timer) clearTimeout(timer);
      logger.info("Webhook delivery worker stopped");
    },
  };
}
