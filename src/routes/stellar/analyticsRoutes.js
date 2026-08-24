// routes/stellar/analyticsRoutes.js
import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validate.js";
import {
  getAnalyticsOverview,
  getAnalyticsSummary,
  getAnalyticsTimeSeries,
} from "../../controllers/stellar/analyticsController.js";
import {
  analyticsTimeSeriesValidation,
  analyticsSummaryValidation,
} from "../../validators/stellarAnalyticsValidators.js";

const router = express.Router();

// Payment analytics is an admin dashboard surface: require auth (mirroring the
// other stellar routes) plus the admin role.
router.use(protect);
router.use(authorizeRoles("admin"));

// Combined summary + time series in one call.
router.get("/", analyticsTimeSeriesValidation, validate, getAnalyticsOverview);

// Per-asset totals only.
router.get(
  "/summary",
  analyticsSummaryValidation,
  validate,
  getAnalyticsSummary
);

// Time series bucketed by day|week|month|year.
router.get(
  "/timeseries",
  analyticsTimeSeriesValidation,
  validate,
  getAnalyticsTimeSeries
);

export default router;
