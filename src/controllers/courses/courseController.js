import Course from "../../models/Course.js";
import mongoose from "mongoose";
import logger from "../../config/logger.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import { emitEvent } from "../../services/webhooks/webhookService.js";

/**
 * Create a new course
 * Note: Files are uploaded from frontend directly to Cloudinary
 * Backend receives URLs instead of file buffers
 */
export const createCourse = catchAsync(async (req, res, next) => {
  const { title, description, category, price, thumbnail, video } = req.body;

  logger.info(`Creating course: ${title} by user: ${req.user._id}`);

  // Validate required fields
  if (!title || !description || !category) {
    return next(
      new APIError("Title, description, and category are required", 400)
    );
  }

  // Create course with URLs from frontend
  const course = await Course.create({
    title,
    description,
    category,
    price: price || 0,
    createdBy: req.user._id,
    thumbnail: thumbnail || null, // URL from frontend
    video: video || null, // URL from frontend
  });

  logger.info(`✅ Course created successfully: ${course._id} - ${title}`);

  res.status(201).json({
    success: true,
    message: "Course created successfully",
    course,
  });
});

// 📚 Get all courses
export const getCourses = async (_req, res) => {
  try {
    const courses = await Course.find().populate(
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
    const course = await Course.findById(req.params.id).populate("createdBy");
    if (!course)
      return res
        .status(404)
        .json({ success: false, message: "Course not found" });

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
    const courses = await Course.find({ createdBy }).populate("createdBy");

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

    // Emit event after saves — fire-and-forget
    emitEvent("course.enrolled", {
      courseId: course._id.toString(),
      courseTitle: course.title,
      userId: req.user._id.toString(),
      enrolledAt: new Date().toISOString(),
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
  const { title, description, category, price, thumbnail, video } = req.body;
  const courseId = req.params.id;

  logger.info(`Updating course: ${courseId}`);

  const course = await Course.findById(courseId);
  if (!course) {
    return next(new APIError("Course not found", 404));
  }

  // Check if user is the creator (authorization)
  if (course.createdBy.toString() !== req.user._id.toString()) {
    logger.warn(`Unauthorized course update attempt by user: ${req.user._id}`);
    return next(
      new APIError("You are not authorized to update this course", 403)
    );
  }

  // Update fields (URLs from frontend)
  course.title = title || course.title;
  course.description = description || course.description;
  course.category = category || course.category;
  course.price = price !== undefined ? price : course.price;

  // Update media URLs if provided
  if (thumbnail) course.thumbnail = thumbnail;
  if (video) course.video = video;

  await course.save();

  logger.info(`✅ Course updated successfully: ${courseId}`);

  res.status(200).json({
    success: true,
    message: "Course updated successfully",
    course,
  });
});

export const addCourseReview = async (req, res) => {
  const { rating, comment } = req.body;
  const course = await Course.findById(req.params.id);

  if (!course) {
    return res
      .status(404)
      .json({ success: false, message: "course not found" });
  }

  // Optional: Prevent duplicate reviews by the same user
  const alreadyReviewed = course.reviews.find(
    (r) => r.user.toString() === req.user._id.toString()
  );
  if (alreadyReviewed) {
    return res.status(400).json({
      success: false,
      message: "course already reviewed by this user",
    });
  }

  const review = {
    user: req.user._id,
    comment,
    rating: Number(rating),
  };

  course.reviews.push(review);

  // Optionally update average rating and review count
  course.rating =
    course.reviews.reduce((acc, item) => item.rating + acc, 0) /
    course.reviews.length;

  await course.save();
  res
    .status(201)
    .json({ success: true, message: "Review added", reviews: course.reviews });
};

// recommended courses for user based on their profile interest
export const fetchRecommendedCourses = async (req, res) => {
  try {
    const { interests } = req.body;
    const recommended = await Course.find({ category: { $in: interests } });
    res.status(200).json({ success: true, recommended });
  } catch (e) {
    res.status(500).json({ success: false, message: e.message });
  }
};
