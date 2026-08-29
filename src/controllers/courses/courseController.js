import Course from "../../models/Course.js";
import CourseProgress from "../../models/CourseProgress.js";
import mongoose from "mongoose";
import logger from "../../config/logger.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import { getCacheOrSet, CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";
import { createNewCourseNotification } from "../notificationController.js";
import contentMetricsService from "../../services/analytics/contentMetricsService.js";
import { emitEvent, EVENT_TYPES } from "../../services/webhooks/webhookService.js";
import {
  categoryTaxonomyExists,
  categoryValidationError,
  resolveActiveCategory,
} from "../../services/categoryService.js";

/**
 * Normalize + defensively validate an optional prerequisites array of course
 * ObjectIds. Returns { ids } on success or { error } (string) on failure.
 * `selfId` (optional) guards against a course listing itself.
 */
const normalizePrerequisites = (prerequisites, selfId) => {
  if (prerequisites === undefined) return { ids: undefined };
  if (!Array.isArray(prerequisites)) {
    return { error: "prerequisites must be an array" };
  }
  const ids = [];
  for (const p of prerequisites) {
    if (!mongoose.Types.ObjectId.isValid(p)) {
      return { error: "Each prerequisite must be a valid Mongo ObjectId" };
    }
    if (selfId && String(p) === String(selfId)) {
      return { error: "A course cannot list itself as a prerequisite" };
    }
    ids.push(p);
  }
  return { ids };
};

/**
 * Create a new course
 * Note: Files are uploaded from frontend directly to Cloudinary
 * Backend receives URLs instead of file buffers
 */
export const createCourse = catchAsync(async (req, res, next) => {
  const { title, description, category, price, thumbnail, video, prerequisites } =
    req.body;

  logger.info(`Creating course: ${title} by user: ${req.user._id}`);

  // Validate required fields
  if (!title || !description || !category) {
    return next(
      new APIError("Title, description, and category are required", 400)
    );
  }

  const { ids: prerequisiteIds, error: prerequisiteError } =
    normalizePrerequisites(prerequisites);
  if (prerequisiteError) {
    return next(new APIError(prerequisiteError, 400));
  }
  const categoryDoc = await resolveActiveCategory(category);
  if (!categoryDoc && (await categoryTaxonomyExists())) {
    return next(new APIError(await categoryValidationError(), 400));
  }

  // Create course with URLs from frontend
  const course = await Course.create({
    title,
    description,
    category: categoryDoc?.name || category,
    categoryRef: categoryDoc?._id,
    price: price || 0,
    createdBy: req.user._id,
    thumbnail: thumbnail || null, // URL from frontend
    video: video || null, // URL from frontend
    ...(prerequisiteIds !== undefined && { prerequisites: prerequisiteIds }),
  });

  logger.info(`✅ Course created successfully: ${course._id} - ${title}`);

  // Emit new course notification asynchronously to followers
  createNewCourseNotification(course._id, req.user._id, course.title).catch((err) =>
    logger.error("Error creating course notification:", err)
  );

  res.status(201).json({
    success: true,
    message: "Course created successfully",
    course,
  });
});

// 📚 Get all courses (public: only published; admin/creator bypass via query)
export const getCourses = async (req, res) => {
  try {
    const filter = {};
    // Non-creators only see published courses
    if (!req.query.createdBy) {
      filter.status = "published";
    }
    if (req.query.category) {
      const categoryDoc = await resolveActiveCategory(req.query.category);
      if (!categoryDoc) return res.status(404).json({ success: false, message: "Category not found" });
      filter.categoryRef = categoryDoc._id;
    }
    const courses = await Course.find(filter).populate(
      "createdBy",
      "name email avatar"
    );
    res.status(200).json({ success: true, courses });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📘 Get a single course
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate("createdBy", "name avatar bio")
      .populate("prerequisites", "title thumbnail");
    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

    // Track a course view for content-performance analytics (issue #244),
    // fire-and-forget so a failed metric write never blocks or fails the
    // detail response.
    contentMetricsService
      .recordCourseView(course._id)
      .catch((err) => logger.error("Failed to increment course view count:", err));

    res.status(200).json({ success: true, course });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📘 Get all courses created by a specific user

export const getCoursesByUser = async (req, res) => {
  logger.info("⚡ Reached getCoursesByUser handler");

  try {
    const { createdBy } = req.query;

    if (!createdBy) {
      logger.info("❌ Missing user ID");
      return res
        .status(400)
        .json({ success: false, message: "Missing user id" });
    }

    // Extra safety to avoid invalid ObjectId crashes
    if (!mongoose.Types.ObjectId.isValid(createdBy)) {
      logger.info("❌ Invalid ObjectId format");
      return res
        .status(400)
        .json({ success: false, message: "Invalid user ID format" });
    }

    logger.info("✅ Finding courses...");
    const courses = await Course.find({ createdBy }).populate("createdBy", "name avatar bio");

    if (!courses || courses.length === 0) {
      return res
        .status(200)
        .json({ success: false, message: "No courses found" });
    }
    res.status(200).json({ success: true, courses });
  } catch (error) {
    logger.error("❌ Unexpected Error in getCoursesByUser:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📥 Enroll a user in a course (Purchase/Enroll)
export const enrollInCourse = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id);

    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

    if (course.enrolledUsers.includes(req.user._id)) {
      return res
        .status(400)
        .json({ success: false, message: "Already enrolled" });
    }

    // Prerequisite gate: the learner must have COMPLETED every prerequisite
    // course (a CourseProgress doc with completedAt set, or percentComplete>=100)
    // before they can enroll in this (advanced) course.
    if (Array.isArray(course.prerequisites) && course.prerequisites.length > 0) {
      const completed = await CourseProgress.find({
        user: req.user._id,
        course: { $in: course.prerequisites },
        $or: [
          { completedAt: { $ne: null } },
          { percentComplete: { $gte: 100 } },
        ],
      }).select("course");

      const completedIds = new Set(completed.map((p) => p.course.toString()));
      const missingIds = course.prerequisites.filter(
        (p) => !completedIds.has(p.toString())
      );

      if (missingIds.length > 0) {
        const missingCourses = await Course.find({
          _id: { $in: missingIds },
        }).select("title");
        const titles = missingCourses.map((c) => c.title).join(", ");
        return res.status(400).json({
          success: false,
          message: `Complete these prerequisites first: ${titles}`,
        });
      }
    }

    // Add user to course's enrolledUsers
    course.enrolledUsers.push(req.user._id);
    await course.save();

    // Also add to user's purchasedCourses
    const User = (await import("../../models/User.js")).default;
    const user = await User.findById(req.user._id);
    if (user) {
      const alreadyPurchased = user.purchasedCourses.some(
        (p) => p.courseId.toString() === course._id.toString()
      );
      if (!alreadyPurchased) {
        user.purchasedCourses.push({
          courseId: course._id,
          purchaseDate: new Date(),
        });
        await user.save();
      }
    }

    await emitEvent(EVENT_TYPES.COURSE_ENROLLED, {
      courseId: course._id.toString(),
      itemTitle: course.title,
      userId: req.user._id.toString(),
    });

    res
      .status(200)
      .json({
        success: true,
        message:
          "Course purchased successfully! You can now access the full content.",
        course,
      });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📝 Edit/Update a course
export const updateCourse = catchAsync(async (req, res, next) => {
  const { title, description, category, price, thumbnail, video, prerequisites } =
    req.body;
  const courseId = req.params.id;

  logger.info(`Updating course: ${courseId}`);

  // Ownership is enforced by authorizeOwnership middleware (req.resource).
  const course = req.resource || (await Course.findById(courseId));
  if (!course) {
    return next(new APIError("Course not found", 404));
  }

  const { ids: prerequisiteIds, error: prerequisiteError } =
    normalizePrerequisites(prerequisites, courseId);
  if (prerequisiteError) {
    return next(new APIError(prerequisiteError, 400));
  }

  // Update fields (URLs from frontend)
  course.title = title || course.title;
  course.description = description || course.description;
  if (category) {
    const categoryDoc = await resolveActiveCategory(category);
    if (!categoryDoc && (await categoryTaxonomyExists())) {
      return next(new APIError(await categoryValidationError(), 400));
    }
    course.category = categoryDoc?.name || category;
    course.categoryRef = categoryDoc?._id;
  }
  course.price = price !== undefined ? price : course.price;

  // Update media URLs if provided
  if (thumbnail) course.thumbnail = thumbnail;
  if (video) course.video = video;

  // Replace prerequisites only when explicitly provided (keeps update PATCH-like).
  if (prerequisiteIds !== undefined) course.prerequisites = prerequisiteIds;

  await course.save();

  logger.info(`✅ Course updated successfully: ${courseId}`);

  res.status(200).json({
    success: true,
    message: "Course updated successfully",
    course,
  });
});

export {
  addCourseReview,
  getCourseReviews,
  updateCourseReview,
  deleteCourseReview,
} from "../reviewController.js";

// Publish a course (draft -> published)
export const publishCourse = catchAsync(async (req, res, next) => {
  const course = req.resource || (await Course.findById(req.params.id));
  if (!course) return next(new APIError("Course not found", 404));

  if (course.status === "published") {
    return next(new APIError("Course is already published", 400));
  }

  if (!course.title || !course.description || !course.category) {
    return next(new APIError("Course must have title, description, and category before publishing", 400));
  }

  course.status = "published";
  course.publishedAt = new Date();
  await course.save();

  res.status(200).json({ success: true, message: "Course published", course });
});

// Unpublish a course (published -> draft)
export const unpublishCourse = catchAsync(async (req, res, next) => {
  const course = req.resource || (await Course.findById(req.params.id));
  if (!course) return next(new APIError("Course not found", 404));

  if (course.status === "draft") {
    return next(new APIError("Course is already a draft", 400));
  }

  course.status = "draft";
  course.publishedAt = undefined;
  await course.save();

  res.status(200).json({ success: true, message: "Course unpublished", course });
});


// recommended courses for user based on their profile interest
export const fetchRecommendedCourses = async (req, res) => {
  try {
    const { interests } = req.body;
    const hasInterests = Array.isArray(interests) && interests.length > 0;

    // This endpoint is POST (interests come in the body), so the shared
    // cacheMiddleware (GET-only) can't key off req.query - cache explicitly here instead.
    const cacheKey = hasInterests
      ? `${CACHE_KEYS.COURSES}recommended:${[...interests].sort().join(",")}`
      : `${CACHE_KEYS.COURSES}recommended:none`;

    const recommended = await getCacheOrSet(
      cacheKey,
      () => Course.find({ category: { $in: interests } }),
      CACHE_TTL.COURSES
    );

    res.status(200).json({ success: true, recommended });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
