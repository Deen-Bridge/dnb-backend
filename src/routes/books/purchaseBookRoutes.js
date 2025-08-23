import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { purchaseBook } from "../../controllers/books/purchaseBookController.js";

const router = express.Router();

router.post("/book", protect, purchaseBook);

export default router;
