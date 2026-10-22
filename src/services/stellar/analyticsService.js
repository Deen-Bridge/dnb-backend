// services/stellar/analyticsService.js
import mongoose from "mongoose";
import Transaction from "../../models/Transaction.js";
import logger from "../../config/logger.js";

/**
 * Payment analytics service.
 *
 * Aggregates Stellar {@link Transaction} data into dashboard-friendly
 * statistics using MongoDB aggregation pipelines (never in-application loops),
 * so it stays efficient over large datasets.
 *
 * Monetary values are stored on the model as precision-preserving STRINGS and a
 * single collection can hold rows in several assets (see `currency`). Sums are
 * therefore always grouped per `currency`, converted to `Decimal128` inside the
 * pipeline via `$toDecimal`, and returned as strings so no precision is lost.
 *
 * Recommended indexes for the query shapes below (the Transaction model already
 * ships some of these; do NOT add them here — this is documentation for ops):
 *  - `{ createdAt: 1 }` — every analytics query filters/buckets on `createdAt`.
 *  - `{ status: 1, createdAt: 1 }` — status filter + time bucketing.
 *  - `{ type: 1, status: 1, createdAt: -1 }` — already present on the model.
 *  - `{ currency: 1, createdAt: 1 }` — asset-scoped time series.
 *  - `{ buyer: 1, createdAt: 1 }` / `{ creator: 1, createdAt: 1 }` — per-user.
 * A compound index that matches the leading equality filters followed by
 * `createdAt` lets the `$match` stage use an index and the pipeline stream
 * results instead of collection-scanning.
 *
 * @module services/stellar/analyticsService
 */

/** Time-bucket granularities supported by the analytics endpoints. */
export const SUPPORTED_PERIODS = ["day", "week", "month", "year"];

/** Default bucket granularity when the caller does not specify one. */
export const DEFAULT_PERIOD = "month";

/**
 * Map an analytics period onto the `unit` argument of `$dateTrunc`.
 * @param {string} period One of {@link SUPPORTED_PERIODS}.
 * @returns {string} A `$dateTrunc` unit.
 */
const dateTruncUnit = (period) =>
  SUPPORTED_PERIODS.includes(period) ? period : DEFAULT_PERIOD;

/**
 * @typedef {Object} AnalyticsFilters
 * @property {string} [status]    Restrict to a single transaction status.
 * @property {string} [type]      Restrict to a transaction type ("purchase"|"donation").
 * @property {string} [currency]  Restrict to a single asset code (e.g. "USDC").
 * @property {string} [buyerId]   Restrict to transactions bought by this user id.
 * @property {string} [creatorId] Restrict to transactions credited to this creator id.
 * @property {Date|string} [startDate] Inclusive lower bound on `createdAt`.
 * @property {Date|string} [endDate]   Inclusive upper bound on `createdAt`.
 */

/**
 * Build the `$match` stage from validated, already-sanitized filters.
 *
 * Only whitelisted fields are consulted, so untrusted query input cannot inject
 * operators into the pipeline.
 *
 * @param {AnalyticsFilters} [filters={}] Filter selection.
 * @returns {Object} A MongoDB match expression.
 */
export const buildMatchStage = (filters = {}) => {
  const match = {};

  if (filters.status) match.status = filters.status;
  if (filters.type) match.type = filters.type;
  if (filters.currency) match.currency = filters.currency;

  if (filters.buyerId && mongoose.Types.ObjectId.isValid(filters.buyerId)) {
    match.buyer = new mongoose.Types.ObjectId(filters.buyerId);
  }
  if (filters.creatorId && mongoose.Types.ObjectId.isValid(filters.creatorId)) {
    match.creator = new mongoose.Types.ObjectId(filters.creatorId);
  }

  if (filters.startDate || filters.endDate) {
    match.createdAt = {};
    if (filters.startDate) match.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) match.createdAt.$lte = new Date(filters.endDate);
  }

  return match;
};

/**
 * Aggregate payment statistics bucketed by time period and asset.
 *
 * Each returned bucket carries: `totalVolume` (summed amount as a string),
 * `transactionCount`, and `averageAmount` (as a string) for a single
 * `(period, currency)` pair.
 *
 * @param {AnalyticsFilters & { period?: string }} [options={}] Bucketing period
 *   plus any filters.
 * @returns {Promise<Array<{
 *   period: string,
 *   periodStart: Date,
 *   currency: string,
 *   totalVolume: string,
 *   transactionCount: number,
 *   averageAmount: string
 * }>>} One entry per (period, currency), sorted oldest-first.
 */
export const getTimeSeriesAnalytics = async (options = {}) => {
  const { period, ...filters } = options;
  const unit = dateTruncUnit(period);
  const match = buildMatchStage(filters);

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        // Amounts are stored as strings; coerce to Decimal128 so sums/averages
        // keep full precision. Malformed values fall back to 0.
        amountDecimal: {
          $convert: { input: "$amount", to: "decimal", onError: 0, onNull: 0 },
        },
      },
    },
    {
      $group: {
        _id: {
          periodStart: { $dateTrunc: { date: "$createdAt", unit } },
          currency: { $ifNull: ["$currency", "USDC"] },
        },
        totalVolume: { $sum: "$amountDecimal" },
        transactionCount: { $sum: 1 },
        averageAmount: { $avg: "$amountDecimal" },
      },
    },
    {
      $project: {
        _id: 0,
        period: unit,
        periodStart: "$_id.periodStart",
        currency: "$_id.currency",
        // Return monetary figures as strings to preserve precision on the wire.
        totalVolume: { $toString: "$totalVolume" },
        transactionCount: 1,
        averageAmount: { $toString: { $ifNull: ["$averageAmount", 0] } },
      },
    },
    { $sort: { periodStart: 1, currency: 1 } },
  ];

  return Transaction.aggregate(pipeline);
};

/**
 * Aggregate overall payment statistics (no time bucketing), grouped by asset.
 *
 * @param {AnalyticsFilters} [filters={}] Filter selection.
 * @returns {Promise<Array<{
 *   currency: string,
 *   totalVolume: string,
 *   transactionCount: number,
 *   averageAmount: string
 * }>>} One entry per asset, highest transaction count first.
 */
export const getSummaryAnalytics = async (filters = {}) => {
  const match = buildMatchStage(filters);

  const pipeline = [
    { $match: match },
    {
      $addFields: {
        amountDecimal: {
          $convert: { input: "$amount", to: "decimal", onError: 0, onNull: 0 },
        },
      },
    },
    {
      $group: {
        _id: { $ifNull: ["$currency", "USDC"] },
        totalVolume: { $sum: "$amountDecimal" },
        transactionCount: { $sum: 1 },
        averageAmount: { $avg: "$amountDecimal" },
      },
    },
    {
      $project: {
        _id: 0,
        currency: "$_id",
        totalVolume: { $toString: "$totalVolume" },
        transactionCount: 1,
        averageAmount: { $toString: { $ifNull: ["$averageAmount", 0] } },
      },
    },
    { $sort: { transactionCount: -1, currency: 1 } },
  ];

  return Transaction.aggregate(pipeline);
};

/**
 * Convenience wrapper returning both the per-asset summary and the time series
 * in a single call, so a dashboard can populate headline totals and a chart
 * from one request.
 *
 * @param {AnalyticsFilters & { period?: string }} [options={}] Period + filters.
 * @returns {Promise<{
 *   period: string,
 *   filters: AnalyticsFilters,
 *   summary: Array<Object>,
 *   series: Array<Object>
 * }>}
 */
export const getPaymentAnalytics = async (options = {}) => {
  const { period = DEFAULT_PERIOD, ...filters } = options;

  try {
    const [summary, series] = await Promise.all([
      getSummaryAnalytics(filters),
      getTimeSeriesAnalytics({ period, ...filters }),
    ]);

    return {
      period: dateTruncUnit(period),
      filters,
      summary,
      series,
    };
  } catch (error) {
    logger.error("Payment analytics aggregation error:", error);
    throw error;
  }
};

export default {
  SUPPORTED_PERIODS,
  DEFAULT_PERIOD,
  buildMatchStage,
  getTimeSeriesAnalytics,
  getSummaryAnalytics,
  getPaymentAnalytics,
};
