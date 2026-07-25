import logger from "../../config/logger.js";
import Book from "../../models/Book.js";
import { getCacheOrSet, CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";

/**
 * Get recommended books based on user interests
 * Matches books by category with user's interests
 */
export const getRecommendedBooks = async (req, res) => {
  try {
    const { interests } = req.body;
    const hasInterests = Array.isArray(interests) && interests.length > 0;

    // This endpoint is POST (interests come in the body), so the shared
    // cacheMiddleware (GET-only) can't key off req.query - cache explicitly here instead.
    const cacheKey = hasInterests
      ? `${CACHE_KEYS.BOOKS}recommended:${[...interests].sort().join(",")}`
      : `${CACHE_KEYS.BOOKS}recommended:popular`;

    const payload = await getCacheOrSet(
      cacheKey,
      async () => {
        if (!hasInterests) {
          // If no interests provided, return recent/popular books
          const books = await Book.find()
            .populate("author", "name email avatar")
            .sort({ readCount: -1 }) // Sort by popularity
            .limit(10);

          return { books, message: "Popular books" };
        }

        // Find books that match user interests
        const recommended = await Book.find({
          category: { $in: interests },
        })
          .populate("author", "name email avatar")
          .sort({ readCount: -1 })
          .limit(10);

        return {
          recommended,
          message: "Books recommended based on your interests",
        };
      },
      CACHE_TTL.BOOKS
    );

    res.status(200).json({ success: true, ...payload });
  } catch (error) {
    logger.error("Error fetching recommended books:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
