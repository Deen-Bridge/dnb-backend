// routes/stellar/paymentRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  initializePayment,
  submitPayment,
  getQuote,
  getPaymentPreflight,
  getTransactionHistory,
  getTransaction,
  cancelTransaction,
} from "../../controllers/stellar/paymentController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Payment flow
router.post("/quote", getQuote);
router.post("/preflight", getPaymentPreflight);
router.post("/initialize", initializePayment);
router.post("/submit", submitPayment);

// Transaction management
router.get("/transactions", getTransactionHistory);
router.get("/transactions/:transactionId", getTransaction);
router.delete("/transactions/:transactionId", cancelTransaction);

export default router;
