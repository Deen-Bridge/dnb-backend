// routes/stellar/paymentRoutes.js
import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  initializePayment,
  submitPayment,
  getTransactionHistory,
  getTransaction,
  cancelTransaction,
} from "../../controllers/stellar/paymentController.js";
import {
  requestRefund,
  buildRefundXdr,
  submitRefund,
  rejectRefund,
  escalateDispute,
  arbitrateDispute,
} from "../../controllers/stellar/refundController.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Payment flow
router.post("/initialize", initializePayment);
router.post("/submit", submitPayment);

// Transaction management
router.get("/transactions", getTransactionHistory);
router.get("/transactions/:transactionId", getTransaction);
router.delete("/transactions/:transactionId", cancelTransaction);

// Refund & Dispute flow
router.post("/transactions/:id/refund-request", requestRefund);
router.post("/refunds/:refundId/build", buildRefundXdr);
router.post("/refunds/:refundId/submit", submitRefund);
router.post("/refunds/:refundId/reject", rejectRefund);
router.post("/refunds/:refundId/dispute", escalateDispute);
router.patch(
  "/refunds/:refundId/arbitrate",
  authorizeRoles("admin", "arbiter"),
  arbitrateDispute
);

export default router;
