import Course from "../models/Course.js";
import Book from "../models/Book.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import { recomputeAndSaveStats } from "../utils/reviewStats.js";
import { verifyItemPurchase } from "../utils/reviewAuth.js";

/**
 * Factory to create review handler for Course or Book.
 */
export const createReviewHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const { rating, comment } = req.body;
    if (!comment || typeof comment !== "string" || comment.trim() === "") {
      return next(new APIError("Comment is required", 400));
    }
    const numericRating = Number(rating);
    if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
      return next(new APIError("Rating must be a number between 1 and 5", 400));
    }

    const item = await Model.findById(req.params.id);
    if (!item) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    // Verified-purchase check
    await verifyItemPurchase({ userId: req.user._id, item, itemType });

    // Enforce one review per user
    const alreadyReviewed = item.reviews.find(
      (r) => r.user.toString() === req.user._id.toString()
    );
    if (alreadyReviewed) {
      return next(
        new APIError(
          `${itemType === "course" ? "course" : "Book"} already reviewed by this user`,
          400
        )
      );
    }

    const review = {
      user: req.user._id,
      comment: comment.trim(),
      rating: numericRating,
      createdAt: new Date(),
    };

    item.reviews.push(review);
    await recomputeAndSaveStats(item);

    res.status(201).json({
      success: true,
      message: "Review added",
      reviews: item.reviews,
      rating: item.rating,
      numReviews: item.numReviews,
      ratingBreakdown: item.ratingBreakdown,
    });
  });

export const getReviewsHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const { page = 1, limit = 10, sort = "recent" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    const item = await Model.findById(req.params.id).populate({
      path: "reviews.user",
      select: "name avatar",
    });

    if (!item) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    let reviewsList = [...item.reviews];

    if (sort === "rating") {
      reviewsList.sort((a, b) => b.rating - a.rating);
    } else if (sort === "helpful") {
      reviewsList.sort((a, b) => b.rating - a.rating || new Date(b.createdAt) - new Date(a.createdAt));
    } else {
      // default: recent
      reviewsList.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    const total = reviewsList.length;
    const startIndex = (pageNum - 1) * limitNum;
    const paginatedReviews = reviewsList.slice(startIndex, startIndex + limitNum);

    res.status(200).json({
      success: true,
      summary: {
        rating: item.rating || 0,
        numReviews: item.numReviews || 0,
        ratingBreakdown: item.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
      pagination: {
        total,
        page: pageNum,
        limit: limitNum,
        pages: Math.ceil(total / limitNum) || 1,
      },
      reviews: paginatedReviews,
    });
  });

export const updateReviewHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const { rating, comment } = req.body;
    const targetReviewId = req.params.reviewId;

    const item = await Model.findById(req.params.id);
    if (!item) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    let review;
    if (targetReviewId) {
      review = item.reviews.id(targetReviewId);
    } else {
      review = item.reviews.find((r) => r.user.toString() === req.user._id.toString());
    }

    if (!review) {
      return next(new APIError("Review not found", 404));
    }

    if (review.user.toString() !== req.user._id.toString()) {
      return next(new APIError("Not authorized to update this review", 403));
    }

    if (comment !== undefined) {
      if (typeof comment !== "string" || comment.trim() === "") {
        return next(new APIError("Comment cannot be empty", 400));
      }
      review.comment = comment.trim();
    }

    if (rating !== undefined) {
      const numericRating = Number(rating);
      if (isNaN(numericRating) || numericRating < 1 || numericRating > 5) {
        return next(new APIError("Rating must be a number between 1 and 5", 400));
      }
      review.rating = numericRating;
    }

    await recomputeAndSaveStats(item);

    res.status(200).json({
      success: true,
      message: "Review updated successfully",
      review,
      rating: item.rating,
      numReviews: item.numReviews,
      ratingBreakdown: item.ratingBreakdown,
    });
  });

export const deleteReviewHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const targetReviewId = req.params.reviewId || req.query.reviewId || req.body.reviewId;

    const item = await Model.findById(req.params.id);
    if (!item) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    let reviewIndex = -1;
    if (targetReviewId) {
      reviewIndex = item.reviews.findIndex(
        (r) => r._id.toString() === targetReviewId.toString()
      );
    } else {
      reviewIndex = item.reviews.findIndex(
        (r) => r.user.toString() === req.user._id.toString()
      );
    }

    if (reviewIndex === -1) {
      return next(new APIError("Review not found", 404));
    }

    const review = item.reviews[reviewIndex];

    const isOwner = review.user.toString() === req.user._id.toString();
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return next(new APIError("Not authorized to delete this review", 403));
    }

    item.reviews.splice(reviewIndex, 1);
    await recomputeAndSaveStats(item);

    res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      rating: item.rating,
      numReviews: item.numReviews,
      ratingBreakdown: item.ratingBreakdown,
    });
  });

// Specific exports for Course and Book
export const addCourseReview = createReviewHandler(Course, "course");
export const getCourseReviews = getReviewsHandler(Course, "course");
export const updateCourseReview = updateReviewHandler(Course, "course");
export const deleteCourseReview = deleteReviewHandler(Course, "course");

export const addBookReview = createReviewHandler(Book, "book");
export const getBookReviews = getReviewsHandler(Book, "book");
export const updateBookReview = updateReviewHandler(Book, "book");
export const deleteBookReview = deleteReviewHandler(Book, "book");
