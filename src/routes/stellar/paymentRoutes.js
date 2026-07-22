// routes/stellar/paymentRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  initializePayment,
  submitPayment,
  getQuote,
  getTransactionHistory,
  getTransaction,
  cancelTransaction,
  getSponsorshipStatus,
} from "../../controllers/stellar/paymentController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Payment flow
router.post("/quote", getQuote);
router.post("/initialize", initializePayment);
router.post("/submit", submitPayment);
router.get("/sponsorship/status", getSponsorshipStatus);

// Transaction management
router.get("/transactions", getTransactionHistory);
router.get("/transactions/:transactionId", getTransaction);
router.delete("/transactions/:transactionId", cancelTransaction);

export default router;
