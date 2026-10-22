// controllers/analytics/contentPerformanceController.js
import mongoose from "mongoose";
import logger from "../../config/logger.js";
import contentMetricsService from "../../services/analytics/contentMetricsService.js";

/**
 * GET /api/analytics/content-performance
 * Comparative analytics across all courses and books: views, engagement,
 * completion rates, and a platform-level roll-up.
 */
export const getContentPerformance = async (req, res) => {
  try {
    const performance = await contentMetricsService.getContentPerformance();
    res.status(200).json({ success: true, ...performance });
  } catch (error) {
    logger.error("Failed to compute content performance:", error);
    res.status(500).json({
      success: false,
      message: "Failed to compute content performance",
    });
  }
};

/**
 * GET /api/analytics/content-performance/:type/:id
 * Metrics for a single course or book.
 */
export const getContentMetrics = async (req, res) => {
  try {
    const { type, id } = req.params;

    if (!["course", "book"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "type must be either 'course' or 'book'",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: "A valid content id is required",
      });
    }

    const metrics = await contentMetricsService.getContentMetrics({ type, id });
    if (!metrics) {
      return res.status(404).json({
        success: false,
        message: "Content not found",
      });
    }

    res.status(200).json({ success: true, metrics });
  } catch (error) {
    logger.error("Failed to compute content metrics:", error);
    res.status(500).json({
      success: false,
      message: "Failed to compute content metrics",
    });
  }
};
