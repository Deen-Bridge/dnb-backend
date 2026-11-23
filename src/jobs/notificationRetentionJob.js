// jobs/notificationRetentionJob.js — Issue #646
/**
 * Scheduled job: enforce the notification retention policy.
 *
 * Notification rows are only soft-deleted by the read path (`isDeleted`), so
 * without a cleanup the collection grows for every user forever — and bulk
 * fan-out makes that worse. This job hard-deletes rows that are past the
 * published retention window, separately for read, unread and deleted rows.
 *
 * Runs once a day (NOTIFICATION_RETENTION_INTERVAL_MS), takes a distributed
 * lease when Redis is available, is safe to re-run, and records what it removed.
 */
import Notification from "../models/Notification.js";
import logger from "../config/logger.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { recordAudit } from "../services/audit/auditService.js";
import { notificationRetentionDeleted } from "../config/metrics.js";
import { withDistributedJobLease } from "../services/distributedJobLease.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const INTERVAL_MS = Number(process.env.NOTIFICATION_RETENTION_INTERVAL_MS) || DAY_MS;

/**
 * Retention policy, in days since the notification was created.
 *
 * - `deleted` is short: the user already removed it from their feed.
 * - `read` keeps a quarter of history so a user can still look back.
 * - `unread` is long: deleting something a user never saw is the most
 *   surprising case, so it only happens after a year.
 * - `protectedTypes` are never purged: they carry account/security meaning.
 */
export const DEFAULT_RETENTION_POLICY = Object.freeze({
  deleted: 30,
  read: 90,
  unread: 365,
  protectedTypes: Object.freeze(["system", "pledge_due"]),
});

const positiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

/** Policy from the environment, falling back to the documented defaults. */
export const resolveRetentionPolicy = (env = process.env) => ({
  deleted: positiveInt(env.NOTIFICATION_RETENTION_DELETED_DAYS, DEFAULT_RETENTION_POLICY.deleted),
  read: positiveInt(env.NOTIFICATION_RETENTION_READ_DAYS, DEFAULT_RETENTION_POLICY.read),
  unread: positiveInt(env.NOTIFICATION_RETENTION_UNREAD_DAYS, DEFAULT_RETENTION_POLICY.unread),
  protectedTypes: [...DEFAULT_RETENTION_POLICY.protectedTypes],
});

/** The created-at boundary for each category. Anything strictly older goes. */
export const retentionCutoffs = (now = new Date(), policy = DEFAULT_RETENTION_POLICY) => ({
  deleted: new Date(now.getTime() - policy.deleted * DAY_MS),
  read: new Date(now.getTime() - policy.read * DAY_MS),
  unread: new Date(now.getTime() - policy.unread * DAY_MS),
});

const categoriesFor = (cutoffs, policy) => {
  const protectedTypes = { type: { $nin: policy.protectedTypes } };
  return [
    // Soft-deleted rows are removed first, so they are not counted twice as read.
    ["deleted", { ...protectedTypes, isDeleted: true, createdAt: { $lt: cutoffs.deleted } }],
    ["read", { ...protectedTypes, isDeleted: false, isRead: true, createdAt: { $lt: cutoffs.read } }],
    ["unread", { ...protectedTypes, isRead: false, createdAt: { $lt: cutoffs.unread } }],
  ];
};

/**
 * Delete (or, with `dryRun`, count) everything past the retention window.
 * Re-running is safe: the filters are absolute, so a second pass matches
 * nothing new.
 */
export const purgeNotifications = async ({
  now = new Date(),
  policy = resolveRetentionPolicy(),
  dryRun = false,
} = {}) => {
  const cutoffs = retentionCutoffs(now, policy);
  const counts = {};

  for (const [category, filter] of categoriesFor(cutoffs, policy)) {
    if (dryRun) {
      counts[category] = await Notification.countDocuments(filter);
      continue;
    }
    const result = await Notification.deleteMany(filter);
    counts[category] = result.deletedCount || 0;
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  return { cutoffs, policy, counts, total, dryRun };
};

/**
 * One retention pass. Never throws: a failed cleanup must not take the process
 * down, it must be visible in the logs instead.
 */
export const runNotificationRetention = async ({ now, dryRun = false } = {}) => {
  const outcome = await withDistributedJobLease("notification-retention", async () => {
    try {
      const result = await purgeNotifications({ now, dryRun });
      for (const [category, count] of Object.entries(result.counts)) {
        notificationRetentionDeleted.inc({ category }, count);
      }
      logger.info(
        { counts: result.counts, total: result.total, dryRun: result.dryRun },
        "Notification retention job completed"
      );
      if (!dryRun && result.total > 0) {
        recordAudit({
          action: AUDIT_ACTIONS.NOTIFICATION_RETENTION_PURGED,
          actor: null,
          targetType: "Notification",
          status: "success",
          metadata: { name: "notification-retention", role: "system" },
        });
      }
      return result;
    } catch (err) {
      logger.error({ err }, "Notification retention job failed");
      return { error: err.message, counts: {}, total: 0, dryRun };
    }
  });

  if (!outcome.acquired) {
    // A held lease means another replica is already doing this pass. A missing
    // Redis only means the lease is unavailable, and this purge is idempotent,
    // so single-instance and test environments still run it.
    if (outcome.reason === "lease_held") {
      logger.debug({ reason: outcome.reason }, "Notification retention job skipped");
      return { skipped: true, reason: outcome.reason };
    }
    logger.debug({ reason: outcome.reason }, "Notification retention job running without a lease");
    return purgeNotifications({ now, dryRun });
  }

  return outcome.result;
};

/**
 * Start the scheduled job. Runs once on boot, then every INTERVAL_MS.
 * @returns {NodeJS.Timeout} interval handle (call clearInterval to stop)
 */
export const startNotificationRetentionJob = () => {
  runNotificationRetention();
  const handle = setInterval(() => runNotificationRetention(), INTERVAL_MS);
  logger.info({ intervalMs: INTERVAL_MS }, "Notification retention job scheduled");
  return handle;
};

export default {
  DEFAULT_RETENTION_POLICY,
  resolveRetentionPolicy,
  retentionCutoffs,
  purgeNotifications,
  runNotificationRetention,
  startNotificationRetentionJob,
};
