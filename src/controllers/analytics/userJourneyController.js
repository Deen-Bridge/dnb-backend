import {
  getUserJourney,
  getFlowPatterns,
  getPageStats,
  getJourneySummary,
  recordJourneyEvent,
} from "../../services/analytics/journey-tracking-service.js";
import logger from "../../config/logger.js";

/**
 * GET /api/analytics/journey
 * Get a user's journey events with filtering.
 */
export const getJourneyHandler = async (req, res) => {
  try {
    const { userId, sessionId, startDate, endDate, page, limit } = req.query;

    // Non-admin users can only query their own journeys
    const targetUserId =
      req.user.role === "admin" && userId ? userId : req.user._id;

    const result = await getUserJourney({
      userId: targetUserId,
      sessionId,
      startDate,
      endDate,
      page,
      limit,
    });

    res.status(200).json({
      success: true,
      data: result.events,
      pagination: result.pagination,
    });
  } catch (error) {
    logger.error("Error fetching user journey:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user journey",
    });
  }
};

/**
 * GET /api/analytics/journey/summary
 * Get summary metrics for journeys.
 */
export const getJourneySummaryHandler = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const summary = await getJourneySummary({ startDate, endDate });

    res.status(200).json({
      success: true,
      data: summary,
    });
  } catch (error) {
    logger.error("Error fetching journey summary:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch journey summary",
    });
  }
};

/**
 * GET /api/analytics/journey/patterns
 * Get common user flow patterns (page transitions).
 */
export const getFlowPatternsHandler = async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query;

    const patterns = await getFlowPatterns({ startDate, endDate, limit });

    res.status(200).json({
      success: true,
      data: patterns,
    });
  } catch (error) {
    logger.error("Error fetching flow patterns:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch flow patterns",
    });
  }
};

/**
 * GET /api/analytics/journey/page-stats
 * Get page visit statistics.
 */
export const getPageStatsHandler = async (req, res) => {
  try {
    const { startDate, endDate, limit } = req.query;

    const stats = await getPageStats({ startDate, endDate, limit });

    res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    logger.error("Error fetching page stats:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch page stats",
    });
  }
};

/**
 * POST /api/analytics/journey/events
 * Manually record a journey event (for client-side tracking).
 */
export const recordEventManuallyHandler = async (req, res) => {
  try {
    const { eventType, page, action, metadata } = req.body;

    if (!page) {
      return res.status(400).json({
        success: false,
        message: "page is required",
      });
    }

    const event = await recordJourneyEvent({
      userId: req.user._id,
      sessionId: req.headers["x-session-id"] || req.user._id.toString(),
      eventType: eventType || "action",
      page,
      action: action || null,
      metadata: metadata || {},
      userAgent: req.headers["user-agent"] || null,
    });

    if (!event) {
      return res.status(500).json({
        success: false,
        message: "Failed to record event",
      });
    }

    res.status(201).json({
      success: true,
      data: event,
    });
  } catch (error) {
    logger.error("Error recording journey event:", error);
    res.status(500).json({
      success: false,
      message: "Failed to record event",
    });
  }
};

export default {
  getJourneyHandler,
  getJourneySummaryHandler,
  getFlowPatternsHandler,
  getPageStatsHandler,
  recordEventManuallyHandler,
};
