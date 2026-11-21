import mongoose from "mongoose";
import IngestionCursor from "../../models/IngestionCursor.js";
import Transaction from "../../models/Transaction.js";
import UnreconciledPayment from "../../models/UnreconciledPayment.js";
import {
  INGESTION_ERROR_CODES,
  listWatchedAccounts,
  resolveLeaseMs,
  resolvePollIntervalMs,
} from "./ingestionConfig.js";
import {
  recordReconciliationHealth,
  setReconciliationHealthProvider,
} from "../../config/metrics.js";

// Reconciliation health status (#696, docs/payment-reconciliation.md).
//
// The admin endpoint returns a versioned DTO built here, never raw
// IngestionCursor or UnreconciledPayment documents, so the storage schema can
// change without breaking dashboards. Every query is index-bounded and capped
// by maxTimeMS, and every list in the response has a fixed upper size.

export const RECONCILIATION_STATUS_VERSION = 1;
export const BACKLOG_SAMPLE_LIMIT = 5;
export const RECONCILIATION_RUNBOOK_URL =
  "https://github.com/Deen-Bridge/dnb-backend/blob/main/docs/payment-reconciliation.md#health-status-and-runbook";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;
const WEEK_SECONDS = 7 * DAY_SECONDS;
const DEFAULT_QUERY_TIMEOUT_MS = 2000;

const DEFAULT_THRESHOLDS = Object.freeze({
  cursorStaleAfterSeconds: 5 * 60,
  cursorStalledAfterSeconds: 30 * 60,
  workerFailureThreshold: 3,
  backlogMaxAgeSeconds: DAY_SECONDS,
  backlogCountThreshold: 50,
  backlogGrowthPerHour: 10,
});

const THRESHOLD_ENV = Object.freeze({
  cursorStaleAfterSeconds: "RECONCILIATION_CURSOR_STALE_SECONDS",
  cursorStalledAfterSeconds: "RECONCILIATION_CURSOR_STALLED_SECONDS",
  workerFailureThreshold: "RECONCILIATION_WORKER_FAILURE_THRESHOLD",
  backlogMaxAgeSeconds: "RECONCILIATION_BACKLOG_MAX_AGE_SECONDS",
  backlogCountThreshold: "RECONCILIATION_BACKLOG_COUNT_THRESHOLD",
  backlogGrowthPerHour: "RECONCILIATION_BACKLOG_GROWTH_PER_HOUR",
});

const STATE_RANK = Object.freeze({ healthy: 0, degraded: 1, stalled: 2 });
const KNOWN_ERROR_CODES = new Set(Object.values(INGESTION_ERROR_CODES));

// Only what classification needs; new storage fields never leak by default.
const CURSOR_FIELDS = [
  "account",
  "lastSyncAt",
  "lastPollAt",
  "lastSuccessAt",
  "consecutiveFailures",
  "lastErrorAt",
  "lastErrorCode",
  "leaseExpiresAt",
  "createdAt",
].join(" ");

const SAMPLE_FIELDS = "stellarTxHash reasonCode referenceKind attempts createdAt lastSeenAt";

const queryTimeoutMs = () => {
  const configured = Number(process.env.RECONCILIATION_QUERY_TIMEOUT_MS);
  return Number.isInteger(configured) && configured > 0 ? configured : DEFAULT_QUERY_TIMEOUT_MS;
};

/**
 * Thresholds behind the overall state, overridable through the environment.
 * Invalid values fall back to the defaults rather than disabling a check.
 */
export const resolveThresholds = (env = process.env) => {
  const resolved = {};
  for (const [key, fallback] of Object.entries(DEFAULT_THRESHOLDS)) {
    const configured = Number(env[THRESHOLD_ENV[key]]);
    resolved[key] = Number.isSafeInteger(configured) && configured > 0 ? configured : fallback;
  }
  // "stalled" must never trigger before "stale", or the warning state could
  // be skipped entirely.
  resolved.cursorStalledAfterSeconds = Math.max(
    resolved.cursorStalledAfterSeconds,
    resolved.cursorStaleAfterSeconds
  );
  return Object.freeze(resolved);
};

/**
 * Keep just enough of an identifier to recognise it (`GABC…WXYZ`). Values
 * too short to truncate meaningfully are fully masked.
 */
export const redactIdentifier = (value, { head = 4, tail = 4 } = {}) => {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length <= head + tail) return "…";
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
};

const isValidDate = (value) => value instanceof Date && !Number.isNaN(value.getTime());

const toIso = (value) => (isValidDate(value) ? value.toISOString() : null);

const secondsSince = (now, value) =>
  isValidDate(value) ? Math.max(0, Math.floor((now.getTime() - value.getTime()) / 1000)) : null;

const secondsBefore = (now, seconds) => new Date(now.getTime() - seconds * 1000);

const describeWorkerLease = (doc, now) => {
  const leaseExpiresAt = isValidDate(doc?.leaseExpiresAt) ? doc.leaseExpiresAt : null;
  let state = "unknown";
  if (leaseExpiresAt) {
    state = leaseExpiresAt.getTime() > now.getTime() ? "active" : "expired";
  }
  return {
    state,
    heartbeatAt: toIso(doc?.lastPollAt),
    leaseExpiresAt: toIso(leaseExpiresAt),
  };
};

/**
 * Classify one watched account from its cursor document (or its absence).
 *
 * - `missing`: no cursor yet; the worker has never polled this account.
 * - `stalled`: no successful poll for longer than cursorStalledAfterSeconds.
 * - `stale`:   no successful poll for longer than cursorStaleAfterSeconds.
 * - `failing`: recent success, but the last workerFailureThreshold polls failed.
 * - `fresh`:   everything else.
 *
 * A cursor that has never succeeded is aged from its creation time, so a
 * worker that fails from its very first poll still goes stale.
 */
export const describeCursor = ({ account, role }, doc, { now, thresholds }) => {
  const base = { role, account: redactIdentifier(account) };

  if (!doc) {
    return {
      ...base,
      state: "missing",
      lastPollAt: null,
      lastSuccessAt: null,
      secondsSinceLastSuccess: null,
      consecutiveFailures: 0,
      lastError: null,
      worker: describeWorkerLease(null, now),
    };
  }

  // Rows written before #696 only carry lastSyncAt.
  const lastSuccessAt = isValidDate(doc.lastSuccessAt) ? doc.lastSuccessAt : doc.lastSyncAt;
  const consecutiveFailures =
    Number.isSafeInteger(doc.consecutiveFailures) && doc.consecutiveFailures > 0 ? doc.consecutiveFailures : 0;
  const ageSeconds = secondsSince(now, isValidDate(lastSuccessAt) ? lastSuccessAt : doc.createdAt);

  let state = "fresh";
  if (ageSeconds === null || ageSeconds > thresholds.cursorStalledAfterSeconds) {
    state = "stalled";
  } else if (ageSeconds > thresholds.cursorStaleAfterSeconds) {
    state = "stale";
  } else if (consecutiveFailures >= thresholds.workerFailureThreshold) {
    state = "failing";
  }

  return {
    ...base,
    state,
    lastPollAt: toIso(doc.lastPollAt),
    lastSuccessAt: toIso(lastSuccessAt),
    secondsSinceLastSuccess: secondsSince(now, lastSuccessAt),
    consecutiveFailures,
    lastError: isValidDate(doc.lastErrorAt)
      ? {
          code: KNOWN_ERROR_CODES.has(doc.lastErrorCode) ? doc.lastErrorCode : "unclassified",
          at: doc.lastErrorAt.toISOString(),
        }
      : null,
    worker: describeWorkerLease(doc, now),
  };
};

/**
 * Fold per-account and backlog signals into one state plus machine-readable
 * reasons. Ingestion problems can stall settlement; backlog problems only
 * ever degrade it, because payments are still being ingested.
 */
export const deriveOverallState = ({ accounts, backlog, throughput, thresholds }) => {
  let state = "healthy";
  const reasons = new Set();
  const escalate = (next, reason) => {
    reasons.add(reason);
    if (STATE_RANK[next] > STATE_RANK[state]) state = next;
  };

  if (accounts.length === 0) {
    escalate("stalled", "no_watched_accounts");
  }

  for (const account of accounts) {
    if (account.state === "missing") escalate("stalled", "cursor_missing");
    if (account.state === "stalled") escalate("stalled", "cursor_stalled");
    if (account.state === "stale") escalate("degraded", "cursor_stale");
    if (account.consecutiveFailures >= thresholds.workerFailureThreshold) {
      escalate("degraded", "worker_failing");
    }
    if (account.worker.state === "expired") escalate("degraded", "worker_lease_expired");
  }

  if (backlog.oldestAgeSeconds !== null && backlog.oldestAgeSeconds > thresholds.backlogMaxAgeSeconds) {
    escalate("degraded", "backlog_aged");
  }
  if (backlog.unreconciledCount >= thresholds.backlogCountThreshold) {
    escalate("degraded", "backlog_large");
  }
  if (throughput.lastHour.netBacklogChange >= thresholds.backlogGrowthPerHour) {
    escalate("degraded", "backlog_growing");
  }

  return { state, reasons: [...reasons] };
};

const loadCursors = async (watched) => {
  const watchedIds = watched.map(({ account }) => account);
  const [docs, unwatchedCursorCount] = await Promise.all([
    IngestionCursor.find({ account: { $in: watchedIds } })
      .select(CURSOR_FIELDS)
      .lean()
      .maxTimeMS(queryTimeoutMs()),
    // Leftovers from a rotated wallet are counted, never listed.
    IngestionCursor.countDocuments({ account: { $nin: watchedIds } }).maxTimeMS(queryTimeoutMs()),
  ]);
  return { byAccount: new Map(docs.map((doc) => [doc.account, doc])), unwatchedCursorCount };
};

const describeSampleRow = (row, now) => ({
  txHash: redactIdentifier(row.stellarTxHash, { head: 6, tail: 4 }),
  reasonCode: row.reasonCode || "unclassified",
  referenceKind: row.referenceKind || null,
  attempts: Number.isSafeInteger(row.attempts) && row.attempts > 0 ? row.attempts : 1,
  firstSeenAt: toIso(row.createdAt),
  lastSeenAt: toIso(row.lastSeenAt),
  ageSeconds: secondsSince(now, row.createdAt),
});

const loadBacklog = async (now) => {
  const open = { resolvedAt: null };
  const count = (filter) => UnreconciledPayment.countDocuments({ ...open, ...filter }).maxTimeMS(queryTimeoutMs());
  const hourAgo = secondsBefore(now, HOUR_SECONDS);
  const dayAgo = secondsBefore(now, DAY_SECONDS);
  const weekAgo = secondsBefore(now, WEEK_SECONDS);

  const [unreconciledCount, under1h, from1hTo24h, from24hTo7d, over7d, byReason, oldest] = await Promise.all([
    count({}),
    count({ createdAt: { $gt: hourAgo } }),
    count({ createdAt: { $gt: dayAgo, $lte: hourAgo } }),
    count({ createdAt: { $gt: weekAgo, $lte: dayAgo } }),
    count({ createdAt: { $lte: weekAgo } }),
    // Grouped by an enum, so the result has a fixed maximum size.
    UnreconciledPayment.aggregate([
      { $match: open },
      { $group: { _id: { $ifNull: ["$reasonCode", "unclassified"] }, count: { $sum: 1 } } },
    ]).option({ maxTimeMS: queryTimeoutMs() }),
    UnreconciledPayment.find({ ...open, createdAt: { $type: "date" } })
      .sort({ createdAt: 1 })
      .limit(BACKLOG_SAMPLE_LIMIT)
      .select(SAMPLE_FIELDS)
      .lean()
      .maxTimeMS(queryTimeoutMs()),
  ]);

  const sample = oldest.map((row) => describeSampleRow(row, now));

  return {
    unreconciledCount,
    byAge: { under1h, from1hTo24h, from24hTo7d, over7d },
    oldestAgeSeconds: sample.length > 0 ? sample[0].ageSeconds : null,
    byReason: Object.fromEntries(byReason.map(({ _id, count: total }) => [_id, total])),
    sampleLimit: BACKLOG_SAMPLE_LIMIT,
    sample,
  };
};

const loadWindow = async (now, windowSeconds) => {
  const since = secondsBefore(now, windowSeconds);
  const timeout = queryTimeoutMs();
  const [unreconciledArrived, unreconciledResolved, confirmedByWorker] = await Promise.all([
    UnreconciledPayment.countDocuments({ createdAt: { $gte: since } }).maxTimeMS(timeout),
    UnreconciledPayment.countDocuments({ resolvedAt: { $gte: since } }).maxTimeMS(timeout),
    Transaction.countDocuments({ reconciledAt: { $gte: since } }).maxTimeMS(timeout),
  ]);
  return {
    windowSeconds,
    unreconciledArrived,
    unreconciledResolved,
    confirmedByWorker,
    netBacklogChange: unreconciledArrived - unreconciledResolved,
  };
};

const loadThroughput = async (now) => {
  const [lastHour, last24h] = await Promise.all([
    loadWindow(now, HOUR_SECONDS),
    loadWindow(now, DAY_SECONDS),
  ]);
  return { lastHour, last24h };
};

/**
 * Build the versioned reconciliation status DTO (v1). See
 * docs/payment-reconciliation.md for field semantics and thresholds.
 *
 * @param {{ now?: Date, env?: NodeJS.ProcessEnv }} [options]
 */
export const getReconciliationStatus = async ({ now = new Date(), env = process.env } = {}) => {
  const thresholds = resolveThresholds(env);
  const watched = listWatchedAccounts(env);

  const [cursors, backlog, throughput] = await Promise.all([
    loadCursors(watched),
    loadBacklog(now),
    loadThroughput(now),
  ]);

  const accounts = watched.map((entry) =>
    describeCursor(entry, cursors.byAccount.get(entry.account) ?? null, { now, thresholds })
  );
  const { state, reasons } = deriveOverallState({ accounts, backlog, throughput, thresholds });

  const status = {
    version: RECONCILIATION_STATUS_VERSION,
    generatedAt: now.toISOString(),
    state,
    reasons,
    thresholds: { ...thresholds },
    ingestion: {
      pollIntervalSeconds: Math.round(resolvePollIntervalMs(env) / 1000),
      leaseSeconds: Math.round(resolveLeaseMs(env) / 1000),
      accounts,
      unwatchedCursorCount: cursors.unwatchedCursorCount,
    },
    backlog,
    throughput,
    runbook: RECONCILIATION_RUNBOOK_URL,
  };

  recordReconciliationHealth(status);
  return status;
};

/**
 * Let Prometheus scrapes refresh the reconciliation health gauges. Called
 * once from server startup; skipped while MongoDB is disconnected so a scrape
 * never queues behind a dead connection.
 */
export const registerReconciliationHealthMetrics = () => {
  setReconciliationHealthProvider(async () => {
    if (mongoose.connection.readyState !== 1) {
      throw new Error("MongoDB is not connected");
    }
    return getReconciliationStatus();
  });
};
