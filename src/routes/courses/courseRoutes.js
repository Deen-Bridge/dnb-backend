import express from "express";
import { invalidateCacheMiddleware } from "../../middlewares/cache.js";
import { CACHE_KEYS } from "../../utils/cache.js";
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
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";

const router = express.Router();

// Cache key generators
const coursesListCacheKey = () => `${CACHE_KEYS.COURSES}list`;
const courseDetailCacheKey = (req) => `${CACHE_KEYS.COURSE}${req.params.id}`;
const coursesByUserCacheKey = (req) =>
  `${CACHE_KEYS.COURSES}user:${req.query.createdBy}`;

// Public routes - cached for 15 minutes
router.get(
  "/",
  cacheMiddleware(CACHE_TTL.COURSES, coursesListCacheKey),
  getCourses
);
router.get(
  "/user",
  cacheMiddleware(CACHE_TTL.COURSES, coursesByUserCacheKey),
  getCoursesByUser
);
router.post("/recommended", fetchRecommendedCourses); // POST routes not cached

// Bookmark routes (MUST come before /:id route to avoid conflicts)
router.get("/bookmarks", protect, getBookmarkedCourses);
router.post("/:courseId/bookmark", protect, toggleCourseBookmark);
router.get("/:courseId/bookmark/check", protect, checkIfBookmarked);
router.delete("/:courseId/bookmark", protect, removeBookmark);

// Dynamic routes - cached for 15 minutes
router.get(
  "/:id",
  cacheMiddleware(CACHE_TTL.COURSES, courseDetailCacheKey),
  getCourseById
);

// Protected routes with cache invalidation
router.post(
  "/",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.CATEGORIES}*`, `${CACHE_KEYS.CATEGORY}*`]),
  createCourse
);
router.post(
  "/:id/enroll",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.CATEGORIES}*`, `${CACHE_KEYS.CATEGORY}*`]),
  enrollInCourse
);
router.post(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`]),
  addCourseReview
);
router.put(
  "/:id",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.CATEGORIES}*`, `${CACHE_KEYS.CATEGORY}*`]),
  updateCourse
);

export default router;
