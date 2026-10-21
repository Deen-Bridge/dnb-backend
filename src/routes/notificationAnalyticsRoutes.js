import express from "express";
import { protect, authorizeRoles } from "../middlewares/authMiddleware.js";
import {
  trackEvent,
  getNotificationMetrics,
} from "../controllers/notificationAnalyticsController.js";

const router = express.Router();

// Record opened/clicked for the caller's own notification
router.post("/events", protect, trackEvent);

// Aggregated metrics (?from=&to=&format=csv)
router.get("/metrics", protect, authorizeRoles("admin"), getNotificationMetrics);

export default router;
