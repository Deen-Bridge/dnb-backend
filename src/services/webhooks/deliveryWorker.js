// services/webhooks/deliveryWorker.js
//
// Out-of-band delivery loop for outbound webhooks. Claims one due delivery at
// a time with an atomic findOneAndUpdate (so two loops/instances never
// double-send the same row), POSTs the signed body with a strict timeout and
// NO redirect following, and records the outcome. Failures are retried on an
// exponential backoff-with-jitter schedule and land in `dead` after the max
// attempts. Sustained dead deliveries auto-disable the endpoint.
//
// All scheduling state lives in the WebhookDelivery document, so this loop can
// later be replaced by the durable job queue (issue #32) without schema change.
import axios from "axios";
import mongoose from "mongoose";
import WebhookEndpoint from "../../models/WebhookEndpoint.js";
import WebhookDelivery, {
  MAX_STORED_ATTEMPTS,
  MAX_ERROR_LENGTH,
} from "../../models/WebhookDelivery.js";
import logger from "../../config/logger.js";
import { decryptSecret } from "./webhookSecret.js";
import { signPayload, WEBHOOK_HEADERS } from "./signing.js";
import { assertDeliverableUrl } from "./urlGuard.js";

// Backoff schedule between attempts: 1m, 5m, 30m, 2h, 12h.
export const BACKOFF_SCHEDULE_MS = [
  60_000,
  5 * 60_000,
  30 * 60_000,
  2 * 60 * 60_000,
  12 * 60 * 60_000,
];

// Total delivery attempts before a delivery is declared dead.
export const MAX_ATTEMPTS = parseInt(process.env.WEBHOOK_MAX_ATTEMPTS || "6", 10);

// Consecutive dead deliveries that auto-disable an endpoint.
export const AUTO_DISABLE_THRESHOLD = parseInt(
  process.env.WEBHOOK_AUTO_DISABLE_THRESHOLD || "5",
  10
);

// Max random jitter added to each backoff. Tests set this to 0 for
// deterministic scheduling assertions.
const BACKOFF_JITTER_MS = parseInt(process.env.WEBHOOK_BACKOFF_JITTER_MS || "30000", 10);

// While a claim is in flight the row's nextAttemptAt is pushed forward by this
// lock window so a concurrent tick cannot re-claim it mid-POST.
const CLAIM_LOCK_MS = 30_000;

const HTTP_TIMEOUT_MS = parseInt(process.env.WEBHOOK_HTTP_TIMEOUT_MS || "10000", 10);
const POLL_INTERVAL_MS = parseInt(process.env.WEBHOOK_POLL_INTERVAL_MS || "5000", 10);
const MAX_PER_TICK = parseInt(process.env.WEBHOOK_MAX_PER_TICK || "50", 10);

/**
 * Compute the delay before the next attempt given how many attempts have
 * already been made. `attemptCount` is 1-based (1 = first attempt just failed).
 */
export const computeBackoffMs = (attemptCount) => {
  const idx = Math.min(attemptCount - 1, BACKOFF_SCHEDULE_MS.length - 1);
  const base = BACKOFF_SCHEDULE_MS[Math.max(0, idx)];
  const jitter = BACKOFF_JITTER_MS > 0 ? Math.floor(Math.random() * BACKOFF_JITTER_MS) : 0;
  return base + jitter;
};

const truncate = (str) =>
  typeof str === "string" && str.length > MAX_ERROR_LENGTH
    ? str.slice(0, MAX_ERROR_LENGTH)
    : str;

// Default HTTP client: a thin axios wrapper that never throws on status and
// never follows redirects. Tests inject their own `post` to stay offline.
const defaultPost = async (url, body, headers) => {
  const res = await axios.post(url, body, {
    headers,
    timeout: HTTP_TIMEOUT_MS,
    maxRedirects: 0,
    // We classify status ourselves; don't let axios throw on 4xx/5xx.
    validateStatus: () => true,
    transformRequest: [(data) => data], // body is already a serialized string
  });
  return { status: res.status };
};

/**
 * Atomically claim the next due delivery. Only ONE concurrent caller can win a
 * given row: the claim flips it to `retrying`, increments `attemptCount`, and
 * pushes `nextAttemptAt` forward by the lock window in a single update.
 *
 * @returns {Promise<Document|null>}
 */
export const claimNextDelivery = async (now = new Date()) => {
  return WebhookDelivery.findOneAndUpdate(
    {
      status: { $in: ["pending", "retrying"] },
      nextAttemptAt: { $lte: now },
    },
    {
      $set: { status: "retrying", nextAttemptAt: new Date(now.getTime() + CLAIM_LOCK_MS) },
      $inc: { attemptCount: 1 },
    },
    { new: true, sort: { nextAttemptAt: 1 } }
  ).select("+_id");
};

const recordSuccessOnEndpoint = async (endpointId, when) => {
  await WebhookEndpoint.updateOne(
    { _id: endpointId },
    { $set: { consecutiveFailures: 0, lastSuccessAt: when, lastDeliveryAt: when } }
  );
};

const recordDeadOnEndpoint = async (endpointId, when) => {
  const ep = await WebhookEndpoint.findOneAndUpdate(
    { _id: endpointId },
    { $inc: { consecutiveFailures: 1 }, $set: { lastDeliveryAt: when } },
    { new: true }
  );
  if (ep && ep.isActive && ep.consecutiveFailures >= AUTO_DISABLE_THRESHOLD) {
    ep.isActive = false;
    ep.disabledAt = when;
    ep.disabledReason = `Auto-disabled after ${ep.consecutiveFailures} consecutive failed deliveries`;
    await ep.save();
    logger.warn(
      { endpointId: String(endpointId), consecutiveFailures: ep.consecutiveFailures },
      "webhook: endpoint auto-disabled after sustained failures"
    );
  }
};

/**
 * Deliver a single already-claimed delivery: sign, POST, record the outcome,
 * and schedule a retry / mark dead / mark delivered as appropriate.
 *
 * @param {Document} delivery a claimed (status `retrying`) delivery document
 * @param {object}   [opts]
 * @param {Function} [opts.post] injected HTTP client `(url, body, headers) => { status }`
 * @param {Date}     [opts.now]
 * @returns {Promise<Document>} the updated delivery
 */
export const deliverClaimed = async (delivery, { post = defaultPost, now = new Date() } = {}) => {
  const endpoint = await WebhookEndpoint.findById(delivery.endpoint).select(
    "+secretEncrypted"
  );

  // Endpoint gone or deactivated — nothing to deliver to. Mark dead so it
  // doesn't churn forever.
  if (!endpoint || !endpoint.isActive) {
    delivery.status = "dead";
    delivery.lastError = "Endpoint missing or inactive";
    delivery.attempts.push({
      at: now,
      error: delivery.lastError,
      durationMs: 0,
    });
    await delivery.save();
    return delivery;
  }

  // Delivery-time SSRF re-check (DNS resolution in production).
  const guard = await assertDeliverableUrl(endpoint.url);
  if (!guard.ok) {
    return finalizeFailure(delivery, endpoint, {
      statusCode: undefined,
      error: `Blocked by SSRF guard: ${guard.reason}`,
      durationMs: 0,
      now,
    });
  }

  let secret;
  try {
    secret = decryptSecret(endpoint.secretEncrypted);
  } catch (err) {
    return finalizeFailure(delivery, endpoint, {
      statusCode: undefined,
      error: `Secret decrypt failed: ${err.message}`,
      durationMs: 0,
      now,
    });
  }

  // Serialize ONCE, sign those exact bytes, POST the same string.
  const rawBody = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(now.getTime() / 1000).toString();
  const signature = signPayload({ secret, timestamp, rawBody });

  const headers = {
    "Content-Type": "application/json",
    [WEBHOOK_HEADERS.EVENT]: delivery.eventType,
    [WEBHOOK_HEADERS.EVENT_ID]: delivery.eventId,
    [WEBHOOK_HEADERS.TIMESTAMP]: timestamp,
    [WEBHOOK_HEADERS.SIGNATURE]: signature,
  };

  const started = Date.now();
  let statusCode;
  let error;
  try {
    const res = await post(endpoint.url, rawBody, headers);
    statusCode = res?.status;
  } catch (err) {
    error = err?.message || "delivery request failed";
  }
  const durationMs = Date.now() - started;

  const delivered = statusCode >= 200 && statusCode < 300;
  if (delivered) {
    delivery.status = "delivered";
    delivery.deliveredAt = now;
    delivery.lastError = undefined;
    pushAttempt(delivery, { at: now, statusCode, durationMs });
    await delivery.save();
    await recordSuccessOnEndpoint(endpoint._id, now);
    return delivery;
  }

  return finalizeFailure(delivery, endpoint, {
    statusCode,
    error: error || `Non-2xx response: ${statusCode}`,
    durationMs,
    now,
  });
};

const pushAttempt = (delivery, attempt) => {
  delivery.attempts.push({ ...attempt, error: truncate(attempt.error) });
  if (delivery.attempts.length > MAX_STORED_ATTEMPTS) {
    delivery.attempts = delivery.attempts.slice(-MAX_STORED_ATTEMPTS);
  }
};

async function finalizeFailure(delivery, endpoint, { statusCode, error, durationMs, now }) {
  pushAttempt(delivery, { at: now, statusCode, error, durationMs });
  delivery.lastError = truncate(error);

  if (delivery.attemptCount >= MAX_ATTEMPTS) {
    delivery.status = "dead";
    await delivery.save();
    await recordDeadOnEndpoint(endpoint._id, now);
    logger.warn(
      { deliveryId: String(delivery._id), attempts: delivery.attemptCount },
      "webhook: delivery moved to dead-letter"
    );
  } else {
    delivery.status = "retrying";
    delivery.nextAttemptAt = new Date(now.getTime() + computeBackoffMs(delivery.attemptCount));
    await delivery.save();
  }
  return delivery;
}

/**
 * Claim + deliver a single due delivery. Returns the delivery, or null when
 * nothing is due. Used by the interval loop and driveable directly by tests.
 */
export const processOne = async ({ post = defaultPost, now = new Date() } = {}) => {
  const delivery = await claimNextDelivery(now);
  if (!delivery) return null;
  return deliverClaimed(delivery, { post, now });
};

/**
 * Drain all currently-due deliveries (bounded per invocation).
 * @returns {Promise<number>} number of deliveries processed
 */
export const runDueDeliveries = async ({ post = defaultPost, now = new Date() } = {}) => {
  let processed = 0;
  while (processed < MAX_PER_TICK) {
    const delivery = await processOne({ post, now });
    if (!delivery) break;
    processed += 1;
  }
  return processed;
};

// ── Interval loop (guarded by env flag, like the ingestion worker) ──────────
let running = false;
let pollTimer = null;

const loop = async () => {
  if (!running) return;
  try {
    if (mongoose.connection.readyState === 1) {
      await runDueDeliveries({ now: new Date() });
    }
  } catch (err) {
    logger.error({ err }, "webhook: delivery loop iteration failed");
  }
  if (!running) return;
  pollTimer = setTimeout(loop, POLL_INTERVAL_MS);
  if (pollTimer && typeof pollTimer.unref === "function") pollTimer.unref();
};

export const startDeliveryWorker = async () => {
  if (running) return;
  running = true;
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "webhook: delivery worker started");
  loop();
};

export const stopDeliveryWorker = async () => {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("webhook: delivery worker stopped");
};
