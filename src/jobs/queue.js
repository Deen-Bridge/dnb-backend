import crypto from "crypto";
import Job from "../models/Job.js";
import logger from "../config/logger.js";

const handlers = new Map();
const inlineKeys = new Set();
const inFlight = new Set();
let accepting = true;
let pollTimer;

const driver = () =>
  process.env.QUEUE_DRIVER || (process.env.NODE_ENV === "test" ? "inline" : "mongo");

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const retryDelay = (base, attempt) => {
  const exponential = base * 2 ** Math.max(0, attempt - 1);
  return exponential + Math.floor(Math.random() * Math.max(1, exponential * 0.2));
};

export const registerJob = (name, handler) => handlers.set(name, handler);

const executeInline = async (name, payload, options) => {
  const handler = handlers.get(name);
  if (!handler) throw new Error(`No handler registered for job ${name}`);
  let attempt = 0;
  while (attempt < options.attempts) {
    attempt += 1;
    try {
      await handler(payload, { attempt, maxAttempts: options.attempts });
      return;
    } catch (error) {
      if (attempt >= options.attempts) {
        logger.error({ job: name, error: error.message }, "Inline job exhausted retries");
        return;
      }
      await delay(retryDelay(options.backoffMs, attempt));
    }
  }
};

export const enqueue = async (name, payload, opts = {}) => {
  if (!accepting) throw new Error("Job queue is shutting down");
  const options = {
    attempts: opts.attempts || 1,
    backoffMs: opts.backoffMs || 1000,
    idempotencyKey:
      opts.idempotencyKey || `${name}:${crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")}`,
    session: opts.session,
  };

  if (driver() === "inline") {
    if (inlineKeys.has(options.idempotencyKey)) return { duplicate: true };
    inlineKeys.add(options.idempotencyKey);
    const promise = new Promise((resolve) => setImmediate(resolve))
      .then(() => executeInline(name, payload, options))
      .finally(() => inFlight.delete(promise));
    inFlight.add(promise);
    return { queued: true, idempotencyKey: options.idempotencyKey };
  }

  const job = await Job.findOneAndUpdate(
    { idempotencyKey: options.idempotencyKey },
    {
      $setOnInsert: {
        name,
        payload,
        idempotencyKey: options.idempotencyKey,
        maxAttempts: options.attempts,
        backoffMs: options.backoffMs,
        status: "queued",
        runAt: new Date(),
      },
    },
    { upsert: true, new: true, session: options.session }
  );
  return { queued: true, id: job._id, duplicate: job.attemptsMade > 0 };
};

const processNext = async () => {
  const job = await Job.findOneAndUpdate(
    { status: { $in: ["queued", "retrying"] }, runAt: { $lte: new Date() } },
    { $set: { status: "active", lockedAt: new Date() }, $inc: { attemptsMade: 1 } },
    { sort: { runAt: 1 }, new: true }
  );
  if (!job) return;

  const promise = (async () => {
    try {
      const handler = handlers.get(job.name);
      if (!handler) throw new Error(`No handler registered for job ${job.name}`);
      await handler(job.payload, {
        attempt: job.attemptsMade,
        maxAttempts: job.maxAttempts,
      });
      await Job.updateOne(
        { _id: job._id },
        { $set: { status: "completed", completedAt: new Date() }, $unset: { lockedAt: 1 } }
      );
    } catch (error) {
      const exhausted = job.attemptsMade >= job.maxAttempts;
      await Job.updateOne(
        { _id: job._id },
        {
          $set: exhausted
            ? { status: "dead", failedAt: new Date(), lastError: error.message }
            : {
                status: "retrying",
                runAt: new Date(Date.now() + retryDelay(job.backoffMs, job.attemptsMade)),
                lastError: error.message,
              },
          $unset: { lockedAt: 1 },
        }
      );
      logger[exhausted ? "error" : "warn"](
        { job: job.name, jobId: job._id, attempt: job.attemptsMade, error: error.message },
        exhausted ? "Job moved to dead letter" : "Job scheduled for retry"
      );
    }
  })().finally(() => inFlight.delete(promise));
  inFlight.add(promise);
};

export const startJobs = async () => {
  if (process.env.JOBS_ENABLED === "false" || driver() === "inline" || pollTimer) return;
  accepting = true;
  await Job.updateMany(
    { status: "active" },
    { $set: { status: "retrying", runAt: new Date() }, $unset: { lockedAt: 1 } }
  );
  pollTimer = setInterval(() => processNext().catch((error) => logger.error(error, "Job poll failed")), 500);
  pollTimer.unref?.();
  logger.info({ driver: driver() }, "Background jobs started");
};

export const stopJobs = async () => {
  accepting = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  await Promise.allSettled([...inFlight]);
};

export const waitForIdle = async () => Promise.allSettled([...inFlight]);

export const resetInlineQueueForTests = () => {
  inlineKeys.clear();
  accepting = true;
};
