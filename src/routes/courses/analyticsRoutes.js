// routes/courses/analyticsRoutes.js
//
// Creator course-analytics endpoints. Mounted at /api/courses/analytics in
// app.js BEFORE the generic course routes so the static "analytics" segment is
// not swallowed by the courseRoutes "/:id" matcher.
//
// All endpoints require authentication (protect). Per-course endpoints
// additionally require ownership of the target course (authorizeOwnership),
// so only a course's creator (or an admin) can read its analytics.

import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { authorizeOwnership } from "../../middlewares/authorize.js";
import Course from "../../models/Course.js";
import {
  getCourseAnalyticsHandler,
  exportCourseAnalyticsHandler,
  getCreatorOverviewHandler,
} from "../../controllers/analytics/courseAnalyticsController.js";

const router = express.Router();

// Ownership guard bound to the :courseId route param.
const requireCourseOwnership = authorizeOwnership({
  model: Course,
  ownerField: "createdBy",
  resourceType: "Course",
  idParam: "courseId",
});

// Portfolio overview across all of the creator's courses.
// Declared before "/:courseId" so the static path wins.
router.get("/overview", protect, getCreatorOverviewHandler);

// Single-course analytics + CSV export (creator-owned).
router.get("/:courseId", protect, requireCourseOwnership, getCourseAnalyticsHandler);
router.get(
  "/:courseId/export",
  protect,
  requireCourseOwnership,
  exportCourseAnalyticsHandler
);

export default router;
