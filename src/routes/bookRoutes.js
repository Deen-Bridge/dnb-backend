import express from "express";
import upload from "../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBooksByAuthor,
  deleteBook,
  getBook,
  fetchRecommendedBooks
} from "../controllers/bookController.js";
import { addBookReview } from "../controllers/bookController.js";
import { protect } from "../middlewares/authMiddleware.js";


const router = express.Router();


// creating book

router.post(
  "/", protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  createBook
);
// getting all books
router.get("/", getBooks);

// get recommended books for user
router.get("/recom", fetchRecommendedBooks)

//get a spefic book
router.get("/:id", getBook);

//get books  created by the author
router.get("/by-author/:authorId", getBooksByAuthor); 

// delete a book
router.delete("/:id", deleteBook);

//review a book
router.post("/:id/reviews", protect, addBookReview);


export default router;


