import mongoose from "mongoose";
import User from "../../models/User.js";
import Book from "../../models/Book.js";
import logger from "../../config/logger.js";

export const toggleBookBookmark = async (req, res) => {
  try {
    const { bookId } = req.params;
    const userId = req.user._id;

    if (!mongoose.Types.ObjectId.isValid(bookId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid book ID format" });
    }

    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    if (!Array.isArray(user.bookmarkedBooks)) {
      user.bookmarkedBooks = [];
    }

    const existingIndex = user.bookmarkedBooks.findIndex(
      (id) => id.toString() === bookId
    );

    let message = "";
    let isBookmarked = false;

    if (existingIndex > -1) {
      user.bookmarkedBooks.splice(existingIndex, 1);
      message = "Book removed from bookmarks";
      logger.info(`Removed bookmark for book ${bookId} by user ${userId}`);
    } else {
      user.bookmarkedBooks.push(bookId);
      message = "Book bookmarked successfully";
      isBookmarked = true;
      logger.info(`Book ${bookId} bookmarked by user ${userId}`);
    }

    await user.save();

    return res.status(200).json({
      success: true,
      isBookmarked,
      message,
      bookmarks: user.bookmarkedBooks,
    });
  } catch (error) {
    logger.error("Error toggling book bookmark:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to toggle bookmark" });
  }
};

export const getBookmarkedBooks = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate({
      path: "bookmarkedBooks",
      populate: {
        path: "author",
        select: "name avatar role",
      },
    });

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    return res.status(200).json({
      success: true,
      bookmarks: user.bookmarkedBooks || [],
      count: user.bookmarkedBooks?.length || 0,
    });
  } catch (error) {
    logger.error("Error fetching bookmarked books:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to fetch bookmarked books" });
  }
};

export const checkIfBookBookmarked = async (req, res) => {
  try {
    const { bookId } = req.params;
    const user = await User.findById(req.user._id).select("bookmarkedBooks");

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    const isBookmarked = user.bookmarkedBooks?.some(
      (id) => id.toString() === bookId
    );

    return res.status(200).json({
      success: true,
      isBookmarked: Boolean(isBookmarked),
    });
  } catch (error) {
    logger.error("Error checking book bookmark status:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to check bookmark status",
    });
  }
};

export const removeBookBookmark = async (req, res) => {
  try {
    const { bookId } = req.params;
    const user = await User.findById(req.user._id);

    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    user.bookmarkedBooks = (user.bookmarkedBooks || []).filter(
      (id) => id.toString() !== bookId
    );
    await user.save();

    return res.status(200).json({
      success: true,
      message: "Bookmark removed successfully",
      bookmarks: user.bookmarkedBooks,
    });
  } catch (error) {
    logger.error("Error removing book bookmark:", error);
    return res
      .status(500)
      .json({ success: false, message: "Failed to remove bookmark" });
  }
};

