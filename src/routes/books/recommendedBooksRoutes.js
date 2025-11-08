import express from "express";
import { getRecommendedBooks } from "../../controllers/books/recommendedBooksController.js";

const router = express.Router();

// POST /api/books/recommended
router.post("/recommended", getRecommendedBooks);

export default router;
