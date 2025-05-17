import express from "express";
import upload from "../middlewares/upload.js";
import {
  createBook,
  getBooks,
  getBook,
  deleteBook,
} from "../controllers/bookController.js";

const router = express.Router();

router.post("/", upload.single("image"), createBook);
router.get("/", getBooks);
router.get("/:id", getBook);
router.delete("/:id", deleteBook);

export default router;
