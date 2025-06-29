import User from "../models/User.js";

export const purchaseBook = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware
    const { bookId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Prevent duplicate purchase
    const alreadyPurchased = user.purchasedBooks.some(
      (b) => b.bookId.toString() === bookId
    );
    if (alreadyPurchased) {
      return res
        .status(400)
        .json({ success: false, message: "Book already purchased" });
    }

    user.purchasedBooks.push({ bookId });
    await user.save();

    res.status(200).json({ success: true, message: "Book purchased" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
