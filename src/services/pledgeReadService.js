import mongoose from "mongoose";

import Pledge from "../models/Pledge.js";
import PledgeCycle from "../models/PledgeCycle.js";
import Transaction from "../models/Transaction.js";
import { decodeCursor, encodeCursor } from "../utils/keysetCursor.js";
import { QUERY_MAX_TIME_MS } from "../utils/queryBudget.js";

/**
 * Read side of recurring pledges (issue #698).
 *
 * Every query here is owner-scoped, page-bounded, projected to the fields the
 * pledge UI needs, and capped by QUERY_MAX_TIME_MS, so a long-lived donor
 * account costs the same per request as a new one.
 */

export const DEFAULT_PLEDGE_PAGE_SIZE = 20;
export const MAX_PLEDGE_PAGE_SIZE = 50;
export const PLEDGE_STATUSES = Object.freeze(["active", "paused", "cancelled"]);

export const PLEDGE_CURSOR_KIND = "pledge";
export const PLEDGE_CYCLE_CURSOR_KIND = "pledge-cycle";

// Projections double as the privacy policy for these endpoints. Pledges omit
// `user` (always the caller) and scheduler internals. The pledge's own
// `publicKey` stays because it is the caller's wallet and the UI shows which
// wallet a pledge debits.
const PLEDGE_FIELDS =
  "_id publicKey amount cadence anchorDay anchorDate status nextDueAt consecutivePaid longestStreak totalPaidStroops lastPaidAt createdAt updatedAt";
const PLEDGE_CYCLE_FIELDS = "_id pledge dueAt windowEndsAt status transaction archivedAt";
// A cycle only needs to know where its payment stands. Wallets, XDR, memos,
// payment references, fee splits and failure details never leave the server.
const PAYMENT_STATUS_FIELDS = "_id status stellarTxHash confirmedAt";

const toId = (value) => (value ? String(value) : null);

/** Public shape of a pledge returned to its owner. */
export const toPledgeDTO = (pledge) => ({
  _id: toId(pledge._id),
  publicKey: pledge.publicKey,
  amount: pledge.amount,
  cadence: pledge.cadence,
  anchorDay: pledge.anchorDay ?? null,
  anchorDate: pledge.anchorDate ?? null,
  status: pledge.status,
  nextDueAt: pledge.nextDueAt ?? null,
  consecutivePaid: pledge.consecutivePaid ?? 0,
  longestStreak: pledge.longestStreak ?? 0,
  totalPaidStroops: pledge.totalPaidStroops ?? "0",
  lastPaidAt: pledge.lastPaidAt ?? null,
  createdAt: pledge.createdAt ?? null,
  updatedAt: pledge.updatedAt ?? null,
});

/** Payment status of a cycle; deliberately not the Transaction document. */
export const toPaymentStatusDTO = (transaction) => ({
  _id: toId(transaction._id),
  status: transaction.status,
  stellarTxHash: transaction.stellarTxHash ?? null,
  confirmedAt: transaction.confirmedAt ?? null,
});

/**
 * @param {object} cycle - lean PledgeCycle
 * @param {object|null} payment - lean Transaction projected to PAYMENT_STATUS_FIELDS
 */
export const toPledgeCycleDTO = (cycle, payment = null) => ({
  _id: toId(cycle._id),
  pledge: toId(cycle.pledge),
  dueAt: cycle.dueAt,
  windowEndsAt: cycle.windowEndsAt,
  status: cycle.status,
  archived: Boolean(cycle.archivedAt),
  transaction: payment ? toPaymentStatusDTO(payment) : null,
});

export const decodePledgeCursor = (raw) => decodeCursor(raw, PLEDGE_CURSOR_KIND, { requireId: true });
export const decodePledgeCycleCursor = (raw) => decodeCursor(raw, PLEDGE_CYCLE_CURSOR_KIND);

const toObjectId = (value) =>
  value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(String(value));

const clampLimit = (limit) => {
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) return DEFAULT_PLEDGE_PAGE_SIZE;
  return Math.min(parsed, MAX_PLEDGE_PAGE_SIZE);
};

/**
 * Fetch `limit + 1` rows so we can tell whether another page exists without a
 * separate count query, then trim the probe row off.
 */
const splitPage = (rows, limit) => {
  const hasMore = rows.length > limit;
  return { items: hasMore ? rows.slice(0, limit) : rows, hasMore };
};

/**
 * One page of the caller's pledges, newest first.
 *
 * Ordering is `createdAt desc, _id desc`; the cursor carries both so rows that
 * share a timestamp are neither skipped nor repeated across pages.
 *
 * @param {{ userId: unknown, status?: string, limit?: number, cursor?: { at: Date, id: string } | null }} params
 */
export const listPledgesForUser = async ({ userId, status, limit, cursor = null }) => {
  const pageSize = clampLimit(limit);
  const filter = { user: toObjectId(userId) };
  if (status) filter.status = status;
  if (cursor) {
    const cursorId = toObjectId(cursor.id);
    filter.$or = [
      { createdAt: { $lt: cursor.at } },
      { createdAt: cursor.at, _id: { $lt: cursorId } },
    ];
  }

  const rows = await Pledge.find(filter)
    .select(PLEDGE_FIELDS)
    .sort({ createdAt: -1, _id: -1 })
    .limit(pageSize + 1)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();

  const { items, hasMore } = splitPage(rows, pageSize);
  const last = items[items.length - 1];
  return {
    pledges: items.map(toPledgeDTO),
    pageInfo: {
      limit: pageSize,
      hasMore,
      nextCursor: hasMore ? encodeCursor(PLEDGE_CURSOR_KIND, last.createdAt, last._id) : null,
    },
  };
};

/**
 * One page of a pledge's cycles, latest due date first.
 *
 * `(pledge, dueAt)` is unique, so `dueAt` alone gives a total order within a
 * pledge and lets the query walk the compound index without an in-memory sort.
 * Archived cycles are excluded unless `includeArchived` is set.
 *
 * @returns {Promise<null | { cycles: object[], pageInfo: object }>} null when
 *   the pledge does not exist or belongs to someone else
 */
export const listPledgeCyclesForUser = async ({
  userId,
  pledgeId,
  limit,
  cursor = null,
  includeArchived = false,
}) => {
  const ownerId = toObjectId(userId);
  const owned = await Pledge.exists({ _id: toObjectId(pledgeId), user: ownerId }).maxTimeMS(QUERY_MAX_TIME_MS);
  if (!owned) return null;

  const pageSize = clampLimit(limit);
  const filter = { pledge: owned._id };
  if (!includeArchived) filter.archivedAt = null;
  if (cursor) filter.dueAt = { $lt: cursor.at };

  const rows = await PledgeCycle.find(filter)
    .select(PLEDGE_CYCLE_FIELDS)
    .sort({ dueAt: -1 })
    .limit(pageSize + 1)
    .maxTimeMS(QUERY_MAX_TIME_MS)
    .lean();
  const { items, hasMore } = splitPage(rows, pageSize);

  const transactionIds = items.map((cycle) => cycle.transaction).filter(Boolean);
  const payments = transactionIds.length
    ? await Transaction.find({ _id: { $in: transactionIds }, buyer: ownerId })
        .select(PAYMENT_STATUS_FIELDS)
        .maxTimeMS(QUERY_MAX_TIME_MS)
        .lean()
    : [];
  const paymentsById = new Map(payments.map((payment) => [String(payment._id), payment]));

  const last = items[items.length - 1];
  return {
    cycles: items.map((cycle) => toPledgeCycleDTO(cycle, paymentsById.get(toId(cycle.transaction)) ?? null)),
    pageInfo: {
      limit: pageSize,
      hasMore,
      nextCursor: hasMore ? encodeCursor(PLEDGE_CYCLE_CURSOR_KIND, last.dueAt) : null,
    },
  };
};

const EMPTY_STATS = Object.freeze({
  totalPaidStroops: "0",
  longestStreak: 0,
  active: 0,
  paused: 0,
  cancelled: 0,
  total: 0,
});

const countStatus = (status) => ({ $sum: { $cond: [{ $eq: ["$status", status] }, 1, 0] } });

/**
 * Totals across all of the caller's pledges, computed in MongoDB.
 *
 * Totals come from the running counters on each Pledge (maintained when a
 * cycle is marked paid), not from cycle rows, so archived or pruned cycle
 * history cannot change them. Stroop totals are summed as Decimal128 to stay
 * exact beyond 2^53.
 */
export const getPledgeStatsForUser = async ({ userId }) => {
  const [row] = await Pledge.aggregate([
    { $match: { user: toObjectId(userId) } },
    {
      $group: {
        _id: null,
        totalPaidStroops: { $sum: { $toDecimal: { $ifNull: ["$totalPaidStroops", "0"] } } },
        longestStreak: { $max: { $ifNull: ["$longestStreak", 0] } },
        active: countStatus("active"),
        paused: countStatus("paused"),
        cancelled: countStatus("cancelled"),
        total: { $sum: 1 },
      },
    },
  ]).option({ maxTimeMS: QUERY_MAX_TIME_MS });

  if (!row) return { ...EMPTY_STATS };
  return {
    // Integer Decimal128 sums keep a zero exponent, so this is a plain digit
    // string; BigInt() normalises it and fails loudly on corrupt data.
    totalPaidStroops: BigInt(row.totalPaidStroops.toString()).toString(),
    longestStreak: row.longestStreak ?? 0,
    active: row.active,
    paused: row.paused,
    cancelled: row.cancelled,
    total: row.total,
  };
};
