/**
 * @module routes/stellar/reportsRoutes
 * @description Routes for financial reports endpoints. All routes require
 * admin authentication for security.
 */

import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  getFinancialReport,
  getMonthlyComparison,
  getDailyRevenueData,
  getReportSummary,
  exportReport,
} from "../../controllers/stellar/reportsController.js";

const router = express.Router();

// All reports routes require authentication and admin role
router.use(protect);
router.use(authorizeRoles("admin"));

/**
 * @route GET /api/stellar/reports
 * @description Generate a financial report for a specified period
 * @access Admin
 */
router.get("/", getFinancialReport);

/**
 * @route GET /api/stellar/reports/summary
 * @description Get summary statistics for dashboard
 * @access Admin
 */
router.get("/summary", getReportSummary);

/**
 * @route GET /api/stellar/reports/comparison
 * @description Get month-over-month comparison report
 * @access Admin
 */
router.get("/comparison", getMonthlyComparison);

/**
 * @route GET /api/stellar/reports/daily
 * @description Get daily revenue data for charts
 * @access Admin
 */
router.get("/daily", getDailyRevenueData);

/**
 * @route GET /api/stellar/reports/export
 * @description Export report data in various formats
 * @access Admin
 */
router.get("/export", exportReport);

export default router;
