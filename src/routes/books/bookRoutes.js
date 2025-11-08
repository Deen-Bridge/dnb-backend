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

const router = express.Router();

// creating book

router.post(
  "/",
  protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  createBook
);
// getting all books
router.get("/", getBooks);

// get recommended books for user
router.get("/recom", fetchRecommendedBooks);

// Bookmarks (must come before dynamic :id routes)
router.get("/bookmarks", protect, getBookmarkedBooks);
router.post("/:bookId/bookmark", protect, toggleBookBookmark);
router.get("/:bookId/bookmark/check", protect, checkIfBookBookmarked);
router.delete("/:bookId/bookmark", protect, removeBookBookmark);

//get books  created by the author
router.get("/by-author/:authorId", getBooksByAuthor);

//get a spefic book
router.get("/:id/preview", protect, streamBookPreview);
router.get("/:id", getBook);

// delete a book
router.delete("/:id", deleteBook);

//review a book
router.post("/:id/reviews", protect, addBookReview);

export default router;
