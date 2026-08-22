import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse,
  getCoursesByUser,
  updateCourse,
  addCourseReview,
  getCourseReviews,
  updateCourseReview,
  deleteCourseReview,
  fetchRecommendedCourses,
} from "../../controllers/courses/courseController.js";
import {
  toggleCourseBookmark,
  getBookmarkedCourses,
  checkIfBookmarked,
  removeBookmark,
} from "../../controllers/courses/bookmarkController.js";
import {
  getCourseProgress,
  updateCourseProgress,
} from "../../controllers/analytics/analyticsController.js";
import { protect, requireVerifiedEducator } from "../../middlewares/authMiddleware.js";
import {
  authorizeOwnership,
  authorizeReviewOwnership,
} from "../../middlewares/authorize.js";
import Course from "../../models/Course.js";
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";

const router = express.Router();

// Cache key generators
const coursesListCacheKey = (req) => `${CACHE_KEYS.COURSES}list:${req.query.category || "all"}`;
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
router.get("/:id/progress", protect, getCourseProgress);
router.post("/:id/progress", protect, updateCourseProgress);

// Review listing route
router.get("/:id/reviews", getCourseReviews);

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
  requireVerifiedEducator,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.EDUCATORS}*`]),
  createCourse
);
router.post(
  "/:id/enroll",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`]),
  enrollInCourse
);
router.post(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`]),
  addCourseReview
);
router.put(
  "/:id/reviews",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.patch(
  "/:id/reviews",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.put(
  "/:id/reviews/:reviewId",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.patch(
  "/:id/reviews/:reviewId",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.delete(
  "/:id/reviews",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  deleteCourseReview
);
router.delete(
  "/:id/reviews/:reviewId",
  protect,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  deleteCourseReview
);
router.put(
  "/:id",
  protect,
  authorizeOwnership({ model: Course, ownerField: "createdBy", resourceType: "Course" }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.COURSE}*`]),
  updateCourse
);

export default router;
