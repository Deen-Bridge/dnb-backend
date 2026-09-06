import {
  getTopSearchQueries,
  getZeroResultSearches,
  getSearchSummary,
  getSearchTrends,
} from "../../services/analytics/search-analytics-service.js";
import logger from "../../config/logger.js";

/**
 * GET /api/analytics/search/top
 * Get top search queries by frequency.
 */
export const getTopSearchQueriesHandler = async (req, res) => {
  try {
    const { startDate, endDate, type, limit, page } = req.query;

    const result = await getTopSearchQueries({
      startDate,
      endDate,
      type,
      limit,
      page,
    });

    res.status(200).json({
      success: true,
      data: result.queries,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("Error fetching top search queries:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch top search queries",
    });
  }
};

/**
 * GET /api/analytics/search/zero-results
 * Get zero-result searches.
 */
export const getZeroResultSearchesHandler = async (req, res) => {
  try {
    const { startDate, endDate, type, limit, page } = req.query;

    const result = await getZeroResultSearches({
      startDate,
      endDate,
      type,
      limit,
      page,
    });

    res.status(200).json({
      success: true,
      data: result.queries,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("Error fetching zero-result searches:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch zero-result searches",
    });
  }
};

/**
 * GET /api/analytics/search/summary
 * Get search analytics summary.
 */
export const getSearchSummaryHandler = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const summary = await getSearchSummary({ startDate, endDate });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error("Error fetching search summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch search summary",
    });
  }
};

/**
 * GET /api/analytics/search/trends
 * Get search trends over time.
 */
export const getSearchTrendsHandler = async (req, res) => {
  try {
    const { startDate, endDate, type } = req.query;

    const trends = await getSearchTrends({ startDate, endDate, type });

    res.status(200).json({
      success: true,
      data: trends,
    });
  } catch (error) {
    logger.error("Error fetching search trends:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch search trends",
    });
  }
};

export default {
  getTopSearchQueriesHandler,
  getZeroResultSearchesHandler,
  getSearchSummaryHandler,
  getSearchTrendsHandler,
};
