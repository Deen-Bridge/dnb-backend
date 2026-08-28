import express from "express";
import {
  updateReadingProgress,
  getReadingProgress,
  getReadingLibrary,
} from "../../controllers/books/readingProgressController.js";
import { protect } from "../../middlewares/authMiddleware.js";
import { validate } from "../../middlewares/validate.js";
import {
  updateReadingProgressValidation,
  readingProgressBookIdValidation,
} from "../../validators/readingProgressValidators.js";

const router = express.Router();

// Reading library augmented with progress %. Declared before the dynamic
// ":bookId" route so the static "library" segment is not captured as a bookId.
router.get("/library/progress", protect, getReadingLibrary);

// Update progress as the user reads (upsert per user + book).
router.put(
  "/:bookId/progress",
  protect,
  updateReadingProgressValidation,
  validate,
  updateReadingProgress
);

// Resume: fetch the last stored position for this user + book.
router.get(
  "/:bookId/progress",
  protect,
  readingProgressBookIdValidation,
  validate,
  getReadingProgress
);

export default router;
