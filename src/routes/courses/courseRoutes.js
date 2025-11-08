import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse,
  getCoursesByUser,
  updateCourse,
  addCourseReview,
  fetchRecommendedCourses,
} from "../../controllers/courses/courseController.js";
import {
  toggleCourseBookmark,
  getBookmarkedCourses,
  checkIfBookmarked,
  removeBookmark,
} from "../../controllers/courses/bookmarkController.js";
import { protect } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// Public routes
router.get("/", getCourses); // GET /api/courses
router.get("/user", getCoursesByUser); // GET /api/courses/user
router.post("/recommended", fetchRecommendedCourses); // POST /api/courses/recommended

// Bookmark routes (MUST come before /:id route to avoid conflicts)
router.get("/bookmarks", protect, getBookmarkedCourses); // Get all bookmarks
router.post("/:courseId/bookmark", protect, toggleCourseBookmark); // Toggle bookmark
router.get("/:courseId/bookmark/check", protect, checkIfBookmarked); // Check if bookmarked
router.delete("/:courseId/bookmark", protect, removeBookmark); // Remove bookmark

// Dynamic routes (MUST come after specific routes like /bookmarks)
router.get("/:id", getCourseById); // GET /api/courses/123

// Protected routes
// Note: No file upload middleware needed - files uploaded from frontend
router.post("/", protect, createCourse);
router.post("/:id/enroll", protect, enrollInCourse);
router.post("/:id/reviews", protect, addCourseReview);
router.put("/:id", protect, updateCourse);

export default router;
