import express from "express";
import mongoose from "mongoose";
import { protect } from "../../middlewares/authMiddleware.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import { getEducatorRevenueAnalytics } from "../../services/analytics/revenue-service.js";
import { revenueAnalyticsToCsv } from "../../utils/analytics/revenue-aggregator.js";

const router = express.Router();

/**
 * GET /api/analytics/revenue
 * Get comprehensive revenue analytics for the authenticated educator.
 */
router.get(
  "/",
  protect,
  catchAsync(async (req, res, next) => {
    const educatorId = req.user._id;
    const { startDate, endDate, period, format } = req.query;

    const analytics = await getEducatorRevenueAnalytics(String(educatorId), {
      startDate: startDate as string,
      endDate: endDate as string,
      period: period as string,
    });

    const exportFormat = String(format || "json").toLowerCase();
    if (exportFormat === "csv") {
      const csv = revenueAnalyticsToCsv(analytics);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="educator-revenue-analytics.csv"');
      return res.status(200).send(csv);
    }

    res.status(200).json({
      success: true,
      analytics,
    });
  })
);

export default router;
