// routes/analytics/contentPerformanceRoutes.js
//
// Content performance analytics endpoints. Mounted at /api/analytics in
// app.js. All endpoints require authentication (protect).
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  getContentPerformance,
  getContentMetrics,
} from "../../controllers/analytics/contentPerformanceController.js";

const router = express.Router();

// Comparative analytics across all courses and books.
router.get("/content-performance", protect, getContentPerformance);

// Metrics for a single item: /content-performance/course/:id | /book/:id
router.get("/content-performance/:type/:id", protect, getContentMetrics);

export default router;
