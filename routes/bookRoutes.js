import express from "express";
import upload from "../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBook,
  deleteBook,
} from "../controllers/bookController.js";
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
router.delete("/:id", deleteBook);

export default router;
