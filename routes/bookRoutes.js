import express from "express";
import upload from "../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBooksByAuthor,
  deleteBook,
  getBook
} from "../controllers/bookController.js";
import { addBookReview } from "../controllers/bookController.js";
import {protect} from "../middlewares/authMiddleware.js";
const router = express.Router();

router.post(
  "/", protect,
  upload.fields([
    { name: "thumbnail", maxCount: 1 },
    { name: "file", maxCount: 1 },
  ]),
  createBook
);
router.get("/", getBooks);
router.get("/:id", getBook);
router.get("/by-author/:authorId", getBooksByAuthor); 
router.delete("/:id", deleteBook);

router.post("/:id/reviews", protect, addBookReview);

export default router;


