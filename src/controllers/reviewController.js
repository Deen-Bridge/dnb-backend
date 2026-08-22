import Course from "../models/Course.js";
import Book from "../models/Book.js";
import User from "../models/User.js";
import mongoose from "mongoose";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import { recomputeAndSaveStats } from "../utils/reviewStats.js";
import { verifyItemPurchase } from "../utils/reviewAuth.js";

const recomputeReviewStats = async (item) => {
  try {
    await recomputeAndSaveStats(item);
  } catch (error) {
    if (error instanceof mongoose.Error.VersionError) {
      throw new APIError("Review was modified by another request. Please try again.", 409);
    }
    throw error;
  }
};

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
    if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
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
    await recomputeReviewStats(item);

    res.status(201).json({
      success: true,
      message: "Review added",
      data: {
        reviews: item.reviews,
        rating: item.rating,
        numReviews: item.numReviews,
        ratingBreakdown: item.ratingBreakdown,
      },
    });
  });

export const getReviewsHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const { page = 1, limit = 10, sort = "recent" } = req.query;
    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));

    if (!mongoose.isValidObjectId(req.params.id)) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    const startIndex = (pageNum - 1) * limitNum;
    const reviewSort = sort === "rating"
      ? { "reviews.rating": -1, "reviews.createdAt": -1 }
      : { "reviews.createdAt": -1 };
    const [result] = await Model.aggregate([
      { $match: { _id: new mongoose.Types.ObjectId(req.params.id) } },
      {
        $facet: {
          metadata: [{
            $project: {
              rating: 1,
              numReviews: 1,
              ratingBreakdown: 1,
              total: { $size: { $ifNull: ["$reviews", []] } },
            },
          }],
          reviews: [
            { $unwind: "$reviews" },
            { $sort: reviewSort },
            { $skip: startIndex },
            { $limit: limitNum },
            {
              $lookup: {
                from: User.collection.name,
                let: { reviewerId: "$reviews.user" },
                pipeline: [
                  { $match: { $expr: { $eq: ["$_id", "$$reviewerId"] } } },
                  { $project: { name: 1, avatar: 1 } },
                ],
                as: "reviewer",
              },
            },
            { $set: { "reviews.user": { $arrayElemAt: ["$reviewer", 0] } } },
            { $project: { _id: 0, reviews: 1 } },
          ],
        },
      },
    ]);

    const metadata = result?.metadata?.[0];
    if (!metadata) {
      return next(new APIError(`${itemType === "course" ? "Course" : "Book"} not found`, 404));
    }

    const total = metadata.total;
    const paginatedReviews = result.reviews.map(({ reviews }) => reviews);

    res.status(200).json({
      success: true,
      message: "Reviews retrieved successfully",
      data: {
        summary: {
          rating: metadata.rating || 0,
          numReviews: metadata.numReviews || 0,
          ratingBreakdown: metadata.ratingBreakdown || { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
        },
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum) || 1,
        },
        reviews: paginatedReviews,
      },
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

    // Ownership is enforced by authorizeReviewOwnership middleware.

    if (comment !== undefined) {
      if (typeof comment !== "string" || comment.trim() === "") {
        return next(new APIError("Comment cannot be empty", 400));
      }
      review.comment = comment.trim();
    }

    if (rating !== undefined) {
      const numericRating = Number(rating);
      if (!Number.isInteger(numericRating) || numericRating < 1 || numericRating > 5) {
        return next(new APIError("Rating must be a number between 1 and 5", 400));
      }
      review.rating = numericRating;
    }

    await recomputeReviewStats(item);

    res.status(200).json({
      success: true,
      message: "Review updated successfully",
      data: {
        review,
        rating: item.rating,
        numReviews: item.numReviews,
        ratingBreakdown: item.ratingBreakdown,
      },
    });
  });

export const deleteReviewHandler = (Model, itemType) =>
  catchAsync(async (req, res, next) => {
    const targetReviewId = req.params.reviewId || req.query.reviewId || req.body?.reviewId;

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

    // Ownership is enforced by authorizeReviewOwnership middleware.

    item.reviews.splice(reviewIndex, 1);
    await recomputeReviewStats(item);

    res.status(200).json({
      success: true,
      message: "Review deleted successfully",
      data: {
        rating: item.rating,
        numReviews: item.numReviews,
        ratingBreakdown: item.ratingBreakdown,
      },
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
