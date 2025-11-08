import Book from "../../models/Book.js";

/**
 * Get recommended books based on user interests
 * Matches books by category with user's interests
 */
export const getRecommendedBooks = async (req, res) => {
  try {
    const { interests } = req.body;

    if (!interests || !Array.isArray(interests) || interests.length === 0) {
      // If no interests provided, return recent/popular books
      const books = await Book.find()
        .populate("author", "name email avatar")
        .sort({ readCount: -1 }) // Sort by popularity
        .limit(10);

      return res.status(200).json({
        success: true,
        books,
        message: "Popular books",
      });
    }

    // Find books that match user interests
    const recommended = await Book.find({
      category: { $in: interests },
    })
      .populate("author", "name email avatar")
      .sort({ readCount: -1 })
      .limit(10);

    res.status(200).json({
      success: true,
      recommended,
      message: "Books recommended based on your interests",
    });
  } catch (error) {
    console.error("Error fetching recommended books:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
