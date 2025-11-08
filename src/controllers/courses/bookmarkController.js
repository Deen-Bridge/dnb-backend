import User from "../../models/User.js";
import Course from "../../models/Course.js";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import logger from "../../config/logger.js";

/**
 * Toggle bookmark for a course
 * If bookmarked, remove it. If not bookmarked, add it.
 */
export const toggleCourseBookmark = catchAsync(async (req, res, next) => {
  const { courseId } = req.params;
  const userId = req.user._id;

  logger.info(`Toggle bookmark for course ${courseId} by user ${userId}`);

  // Check if course exists
  const course = await Course.findById(courseId);
  if (!course) {
    return next(new APIError("Course not found", 404));
  }

  // Get user
  const user = await User.findById(userId);
  if (!user) {
    return next(new APIError("User not found", 404));
  }

  // Check if already bookmarked
  const bookmarkIndex = user.bookmarkedCourses.indexOf(courseId);
  let isBookmarked = false;

  if (bookmarkIndex > -1) {
    // Remove bookmark
    user.bookmarkedCourses.splice(bookmarkIndex, 1);
    isBookmarked = false;
    logger.info(`Removed bookmark for course ${courseId}`);
  } else {
    // Add bookmark
    user.bookmarkedCourses.push(courseId);
    isBookmarked = true;
    logger.info(`Added bookmark for course ${courseId}`);
  }

  await user.save();

  res.status(200).json({
    success: true,
    message: isBookmarked
      ? "Course bookmarked successfully"
      : "Bookmark removed successfully",
    isBookmarked,
    bookmarkedCourses: user.bookmarkedCourses,
  });
});

/**
 * Get all bookmarked courses for authenticated user
 */
export const getBookmarkedCourses = catchAsync(async (req, res, next) => {
  const userId = req.user._id;

  logger.info(`Fetching bookmarked courses for user ${userId}`);

  const user = await User.findById(userId).populate({
    path: "bookmarkedCourses",
    populate: {
      path: "createdBy",
      select: "name email avatar",
    },
  });

  if (!user) {
    return next(new APIError("User not found", 404));
  }

  res.status(200).json({
    success: true,
    bookmarks: user.bookmarkedCourses,
    count: user.bookmarkedCourses.length,
  });
});

/**
 * Check if a course is bookmarked by the user
 */
export const checkIfBookmarked = catchAsync(async (req, res, next) => {
  const { courseId } = req.params;
  const userId = req.user._id;

  const user = await User.findById(userId);
  if (!user) {
    return next(new APIError("User not found", 404));
  }

  const isBookmarked = user.bookmarkedCourses.includes(courseId);

  res.status(200).json({
    success: true,
    isBookmarked,
  });
});

/**
 * Remove a bookmark
 */
export const removeBookmark = catchAsync(async (req, res, next) => {
  const { courseId } = req.params;
  const userId = req.user._id;

  logger.info(`Removing bookmark for course ${courseId} by user ${userId}`);

  const user = await User.findById(userId);
  if (!user) {
    return next(new APIError("User not found", 404));
  }

  // Remove from bookmarks
  user.bookmarkedCourses = user.bookmarkedCourses.filter(
    (id) => id.toString() !== courseId.toString()
  );

  await user.save();

  res.status(200).json({
    success: true,
    message: "Bookmark removed successfully",
    bookmarkedCourses: user.bookmarkedCourses,
  });
});
