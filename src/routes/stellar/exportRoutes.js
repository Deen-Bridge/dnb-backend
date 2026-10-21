// routes/stellar/exportRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  exportTransactions,
  exportSummary,
} from "../../controllers/stellar/exportController.js";

const router = express.Router();

// All export routes require authentication; exports are scoped to req.user.
router.use(protect);

// Download the user's transactions as CSV or PDF (?format=csv|pdf) with
// optional startDate / endDate / status filters.
router.get("/transactions", exportTransactions);

// Preview the summary totals/statistics as JSON (same filters, no file).
router.get("/summary", exportSummary);

export default router;
