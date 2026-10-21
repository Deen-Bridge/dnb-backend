import express from "express";
import {
  createCourse,
  getCourses,
  getCourseById,
  enrollInCourse,
  getCoursesByUser,
  updateCourse,
  publishCourse,
  unpublishCourse,
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
import { getBundlesByCourse } from "../../controllers/course-bundle.controller.js";
import { generateCertificateController } from "../../controllers/certificate.controller.js";
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
import { validate } from "../../middlewares/validate.js";
import {
  createCourseValidation,
  updateCourseValidation,
  courseIdParamValidation,
  courseIdParamNamedValidation,
  listCoursesValidation,
  coursesByUserValidation,
  recommendedCoursesValidation,
  createReviewValidation,
  updateReviewValidation,
  deleteReviewValidation,
  listReviewsValidation,
  courseProgressUpdateValidation,
} from "../../validators/courseValidators.js";
import { CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";
import { trackAction } from "../../middlewares/analytics/journey-tracker.js";

const router = express.Router();

// Cache key generators
const coursesListCacheKey = (req) => {
  const queryStr = new URLSearchParams(req.query).toString();
  return `${CACHE_KEYS.COURSES}list:${queryStr || "all"}`;
};
const courseDetailCacheKey = (req) => `${CACHE_KEYS.COURSE}${req.params.id}`;
const coursesByUserCacheKey = (req) =>
  `${CACHE_KEYS.COURSES}user:${req.query.createdBy}`;

// Public routes - cached for 15 minutes
router.get(
  "/",
  listCoursesValidation,
  validate,
  cacheMiddleware(CACHE_TTL.COURSES, coursesListCacheKey),
  getCourses
);
router.get(
  "/user",
  coursesByUserValidation,
  validate,
  cacheMiddleware(CACHE_TTL.COURSES, coursesByUserCacheKey),
  getCoursesByUser
);
router.post("/recommended", recommendedCoursesValidation, validate, fetchRecommendedCourses); // POST routes not cached

// Bookmark routes (MUST come before /:id route to avoid conflicts)
router.get("/bookmarks", protect, getBookmarkedCourses);
router.post("/:courseId/bookmark", protect, courseIdParamNamedValidation, validate, toggleCourseBookmark);
router.get("/:courseId/bookmark/check", protect, courseIdParamNamedValidation, validate, checkIfBookmarked);
router.delete("/:courseId/bookmark", protect, courseIdParamNamedValidation, validate, removeBookmark);
router.get("/:id/progress", protect, courseIdParamValidation, validate, getCourseProgress);
router.post("/:id/progress", protect, courseProgressUpdateValidation, validate, updateCourseProgress);

// Review listing route
router.get("/:id/reviews", listReviewsValidation, validate, getCourseReviews);
router.get("/:courseId/bundles", courseIdParamNamedValidation, validate, getBundlesByCourse);

// Dynamic routes - cached for 15 minutes
router.get(
  "/:id",
  courseIdParamValidation,
  validate,
  cacheMiddleware(CACHE_TTL.COURSES, courseDetailCacheKey),
  getCourseById
);

// Protected routes with cache invalidation
router.post(
  "/",
  protect,
  requireVerifiedEducator,
  createCourseValidation,
  validate,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.EDUCATORS}*`]),
  createCourse
);
router.post(
  "/:id/enroll",
  protect,
  courseIdParamValidation,
  validate,
  // Journey analytics: record the enrollment as a key user action (issue #246).
  trackAction("enroll_course"),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`]),
  enrollInCourse
);
router.post(
  "/:id/reviews",
  protect,
  createReviewValidation,
  validate,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`]),
  addCourseReview
);
router.put(
  "/:id/reviews",
  protect,
  updateReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.patch(
  "/:id/reviews",
  protect,
  updateReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.put(
  "/:id/reviews/:reviewId",
  protect,
  updateReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.patch(
  "/:id/reviews/:reviewId",
  protect,
  updateReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  updateCourseReview
);
router.delete(
  "/:id/reviews",
  protect,
  deleteReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  deleteCourseReview
);
router.delete(
  "/:id/reviews/:reviewId",
  protect,
  deleteReviewValidation,
  validate,
  authorizeReviewOwnership({ model: Course }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSE}*`, `${CACHE_KEYS.COURSES}*`]),
  deleteCourseReview
);
router.put(
  "/:id",
  protect,
  authorizeOwnership({ model: Course, ownerField: "createdBy", resourceType: "Course" }),
  updateCourseValidation,
  validate,
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.COURSE}*`]),
  updateCourse
);
router.patch(
  "/:id/publish",
  protect,
  courseIdParamValidation,
  validate,
  authorizeOwnership({ model: Course, ownerField: "createdBy", resourceType: "Course" }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.COURSE}*`]),
  publishCourse
);
router.patch(
  "/:id/unpublish",
  protect,
  courseIdParamValidation,
  validate,
  authorizeOwnership({ model: Course, ownerField: "createdBy", resourceType: "Course" }),
  invalidateCacheMiddleware([`${CACHE_KEYS.COURSES}*`, `${CACHE_KEYS.COURSE}*`]),
  unpublishCourse
);

// Course Certificate generation (Issue #125)
router.post("/:id/certificate", protect, courseIdParamValidation, validate, generateCertificateController);

export default router;
