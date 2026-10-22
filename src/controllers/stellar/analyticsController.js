// controllers/stellar/analyticsController.js
import {
  getPaymentAnalytics,
  getSummaryAnalytics,
  getTimeSeriesAnalytics,
  DEFAULT_PERIOD,
} from "../../services/stellar/analyticsService.js";
import logger from "../../config/logger.js";

/**
 * Analytics controllers for the payment dashboard.
 *
 * Each handler translates validated query parameters into service filters and
 * returns aggregated statistics. Validation of the query shape is performed by
 * the route's express-validator chain before these run.
 *
 * @module controllers/stellar/analyticsController
 */

/**
 * Pull whitelisted analytics filters off the request query.
 * @param {import("express").Request} req Express request.
 * @returns {import("../../services/stellar/analyticsService.js").AnalyticsFilters}
 */
const extractFilters = (req) => {
  const { status, type, currency, buyerId, creatorId, startDate, endDate } =
    req.query;
  return { status, type, currency, buyerId, creatorId, startDate, endDate };
};

/**
 * GET /api/stellar/analytics
 * Combined per-asset summary plus a time series bucketed by `period`.
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 */
export const getAnalyticsOverview = async (req, res) => {
  try {
    const period = req.query.period || DEFAULT_PERIOD;
    const filters = extractFilters(req);

    const data = await getPaymentAnalytics({ period, ...filters });

    res.status(200).json({
      success: true,
      ...data,
    });
  } catch (error) {
    logger.error("Get analytics overview error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment analytics",
    });
  }
};

/**
 * GET /api/stellar/analytics/summary
 * Per-asset totals (volume, count, average) with no time bucketing.
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 */
export const getAnalyticsSummary = async (req, res) => {
  try {
    const filters = extractFilters(req);
    const summary = await getSummaryAnalytics(filters);

    res.status(200).json({
      success: true,
      filters,
      summary,
    });
  } catch (error) {
    logger.error("Get analytics summary error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment analytics summary",
    });
  }
};

/**
 * GET /api/stellar/analytics/timeseries
 * Statistics bucketed by `period` (day|week|month|year) and asset.
 * @param {import("express").Request} req Express request.
 * @param {import("express").Response} res Express response.
 */
export const getAnalyticsTimeSeries = async (req, res) => {
  try {
    const period = req.query.period || DEFAULT_PERIOD;
    const filters = extractFilters(req);

    const series = await getTimeSeriesAnalytics({ period, ...filters });

    res.status(200).json({
      success: true,
      period,
      filters,
      series,
    });
  } catch (error) {
    logger.error("Get analytics time series error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payment analytics time series",
    });
  }
};

export default {
  getAnalyticsOverview,
  getAnalyticsSummary,
  getAnalyticsTimeSeries,
};
