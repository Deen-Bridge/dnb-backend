import express from "express";
import { uploadBook } from "../../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBooksByAuthor,
  deleteBook,
  getBook,
  fetchRecommendedBooks,
  addBookReview,
  getBookReviews,
  updateBookReview,
  deleteBookReview,
  streamBookPreview,
} from "../../controllers/books/bookController.js";
import {
  toggleBookBookmark,
  getBookmarkedBooks,
  checkIfBookBookmarked,
  removeBookBookmark,
} from "../../controllers/books/bookmarkBookController.js";
import { protect, requireVerifiedEducator } from "../../middlewares/authMiddleware.js";
import {
  cacheMiddleware,
  invalidateCacheMiddleware,
} from "../../middlewares/cache.js";
import { CACHE_TTL, CACHE_KEYS } from "../../utils/cache.js";

const router = express.Router();

// Cache key generators
const booksListCacheKey = () => `${CACHE_KEYS.BOOKS}list`;
const bookDetailCacheKey = (req) => `${CACHE_KEYS.BOOK}${req.params.id}`;
const booksByAuthorCacheKey = (req) =>
  `${CACHE_KEYS.BOOKS}author:${req.params.authorId}`;

// creating book - invalidates books list cache
router.post(
  "/",
  protect,
  requireVerifiedEducator,
  uploadBook.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOKS}*`, `${CACHE_KEYS.EDUCATORS}*`]),
  createBook
);

// getting all books - cached for 15 minutes
router.get("/", cacheMiddleware(CACHE_TTL.BOOKS, booksListCacheKey), getBooks);

// get recommended books for user - cached for 5 minutes
router.get(
  "/recom",
  cacheMiddleware(CACHE_TTL.SHORT, () => `${CACHE_KEYS.BOOKS}recommended`),
  fetchRecommendedBooks
);

// Bookmarks (must come before dynamic :id routes)
router.get("/bookmarks", protect, getBookmarkedBooks);
router.post("/:bookId/bookmark", protect, toggleBookBookmark);
router.get("/:bookId/bookmark/check", protect, checkIfBookBookmarked);
router.delete("/:bookId/bookmark", protect, removeBookBookmark);

// Review listing route
router.get("/:id/reviews", getBookReviews);

// get books created by the author - cached for 15 minutes
router.get(
  "/by-author/:authorId",
  cacheMiddleware(CACHE_TTL.BOOKS, booksByAuthorCacheKey),
  getBooksByAuthor
);

// get a specific book - cached for 15 minutes
router.get("/:id/preview", protect, streamBookPreview);
router.get(
  "/:id",
  cacheMiddleware(CACHE_TTL.BOOKS, bookDetailCacheKey),
  getBook
);

// delete a book - invalidates book caches
router.delete(
  "/:id",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOKS}*`, `${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.EDUCATORS}*`]),
  deleteBook
);

// review a book - invalidates specific book cache
router.post(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`]),
  addBookReview
);
router.put(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  updateBookReview
);
router.patch(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  updateBookReview
);
router.put(
  "/:id/reviews/:reviewId",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  updateBookReview
);
router.patch(
  "/:id/reviews/:reviewId",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  updateBookReview
);
router.delete(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  deleteBookReview
);
router.delete(
  "/:id/reviews/:reviewId",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`, `${CACHE_KEYS.BOOKS}*`]),
  deleteBookReview
);

export default router;

