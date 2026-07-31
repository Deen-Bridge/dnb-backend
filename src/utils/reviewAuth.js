import User from "../models/User.js";
import { APIError } from "../middlewares/errorHandler.js";

/**
 * Ensures user has purchased/enrolled or created the course/book.
 * @param {object} params
 * @param {import("mongoose").Types.ObjectId|string} params.userId
 * @param {object} params.item - Course or Book Mongoose doc
 * @param {"course" | "book"} params.itemType
 */
export const verifyItemPurchase = async ({ userId, item, itemType }) => {
  const userIdStr = userId.toString();

  if (itemType === "course") {
    if (item.createdBy && item.createdBy.toString() === userIdStr) {
      return true;
    }
    if (
      item.enrolledUsers &&
      item.enrolledUsers.some((id) => id.toString() === userIdStr)
    ) {
      return true;
    }
  } else if (itemType === "book") {
    if (item.author && item.author.toString() === userIdStr) {
      return true;
    }
  }

  const user = await User.findById(userId).select("purchasedCourses purchasedBooks");
  if (!user) {
    throw new APIError("User not found", 404);
  }

  if (itemType === "course") {
    const isPurchased = user.purchasedCourses?.some(
      (p) => p.courseId && p.courseId.toString() === item._id.toString()
    );
    if (isPurchased) return true;
  } else if (itemType === "book") {
    const isPurchased = user.purchasedBooks?.some(
      (p) => p.bookId && p.bookId.toString() === item._id.toString()
    );
    if (isPurchased) return true;
  }

  throw new APIError(
    `You must purchase or enroll in this ${itemType} to submit a review`,
    403
  );
};
