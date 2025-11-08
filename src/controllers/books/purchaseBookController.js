import mongoose from "mongoose";
import User from "../../models/User.js";
import Book from "../../models/Book.js";

export const purchaseBook = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware
    const { bookId } = req.body;

    if (!bookId || !mongoose.Types.ObjectId.isValid(bookId)) {
      return res
        .status(400)
        .json({ success: false, message: "Valid bookId is required" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Prevent duplicate purchase
    const book = await Book.findById(bookId);
    if (!book) {
      return res
        .status(404)
        .json({ success: false, message: "Book not found" });
    }

    if (!Array.isArray(user.purchasedBooks)) {
      user.purchasedBooks = [];
    }

    const alreadyPurchased = user.purchasedBooks.some(
      (b) => b.bookId.toString() === bookId
    );
    if (alreadyPurchased) {
      return res
        .status(200)
        .json({ success: true, message: "Book already purchased" });
    }

    user.purchasedBooks.push({ bookId });
    if (!user.stat) user.stat = {};
    user.stat.booksRead = (user.stat.booksRead || 0) + 1;

    await user.save();

    res.status(200).json({
      success: true,
      message: "Book purchased successfully",
      book: {
        _id: book._id,
        title: book.title,
        fileUrl: book.fileUrl,
        price: book.price,
      },
      purchasedBooks: user.purchasedBooks,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
