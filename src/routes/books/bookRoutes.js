import express from "express";
import upload from "../../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBooksByAuthor,
  deleteBook,
  getBook,
  fetchRecommendedBooks,
  addBookReview,
  streamBookPreview,
} from "../../controllers/books/bookController.js";
import {
  toggleBookBookmark,
  getBookmarkedBooks,
  checkIfBookBookmarked,
  removeBookBookmark,
} from "../../controllers/books/bookmarkBookController.js";
import { protect } from "../../middlewares/authMiddleware.js";
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
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOKS}*`]),
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
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOKS}*`, `${CACHE_KEYS.BOOK}*`]),
  deleteBook
);

// review a book - invalidates specific book cache
router.post(
  "/:id/reviews",
  protect,
  invalidateCacheMiddleware([`${CACHE_KEYS.BOOK}*`]),
  addBookReview
);

export default router;
