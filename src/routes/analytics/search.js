import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  getTopSearchQueriesHandler,
  getZeroResultSearchesHandler,
  getSearchSummaryHandler,
  getSearchTrendsHandler,
} from "../../controllers/analytics/searchAnalyticsController.js";

const router = express.Router();

// All search analytics endpoints require admin authentication
router.use(protect, authorizeRoles("admin"));

// Top search queries by frequency
router.get("/top", getTopSearchQueriesHandler);

// Zero-result searches
router.get("/zero-results", getZeroResultSearchesHandler);

// Search summary metrics
router.get("/summary", getSearchSummaryHandler);

// Search trends over time
router.get("/trends", getSearchTrendsHandler);

export default router;
