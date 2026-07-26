import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  getEducatorEarnings,
  getPlatformAnalytics,
  getCourseProgress,
  updateCourseProgress,
  getUserLearning,
} from "../../controllers/analytics/analyticsController.js";

const router = express.Router();

router.get("/me/earnings", protect, getEducatorEarnings);
router.get("/platform", protect, authorizeRoles("admin"), getPlatformAnalytics);
router.get("/platform/timeseries", protect, authorizeRoles("admin"), getPlatformAnalytics);
router.get("/top-educators", protect, authorizeRoles("admin"), getPlatformAnalytics);
router.get("/top-items", protect, authorizeRoles("admin"), getPlatformAnalytics);
router.get("/courses/:id/progress", protect, getCourseProgress);
router.post("/courses/:id/progress", protect, updateCourseProgress);
router.get("/users/me/learning", protect, getUserLearning);

export default router;
