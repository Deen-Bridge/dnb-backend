import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  getJourneyHandler,
  getFlowPatternsHandler,
  getPageStatsHandler,
  getJourneySummaryHandler,
  recordEventManuallyHandler,
} from "../../controllers/analytics/userJourneyController.js";

const router = express.Router();

// All journey analytics endpoints require authentication
router.use(protect);

// Get a user's journey events (filtered by session, date range, etc.)
router.get("/", getJourneyHandler);

// Get summary metrics for journeys
router.get("/summary", getJourneySummaryHandler);

// Get common user flow patterns (page transitions)
router.get("/patterns", getFlowPatternsHandler);

// Get page visit statistics
router.get("/page-stats", getPageStatsHandler);

// Manually record a journey event (for client-side tracking)
router.post("/events", recordEventManuallyHandler);

// Admin-only: bulk query across all users
router.get("/admin/all", authorizeRoles("admin"), getJourneyHandler);

export default router;
