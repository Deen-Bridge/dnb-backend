// routes/stellar/paymentRoutes.js
import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  initializePayment,
  submitPayment,
  getQuote,
  getPaymentPreflight,
  getTransactionHistory,
  getTransaction,
  cancelTransaction,
  sponsorshipStatus,
} from "../../controllers/stellar/paymentController.js";
import {
  requestRefund,
  buildRefundXdr,
  submitRefund,
  rejectRefund,
  escalateDispute,
  arbitrateDispute,
} from "../../controllers/stellar/refundController.js";
import { reconciliationStatus } from "../../controllers/stellar/reconciliationController.js";
import { validate } from "../../middlewares/validate.js";
import {
  initializePaymentValidation,
  submitPaymentValidation,
} from "../../validators/requestValidators.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Payment flow
router.post("/quote", getQuote);
router.post("/preflight", getPaymentPreflight);
router.post(
  "/initialize",
  initializePaymentValidation,
  validate,
  idempotency(),
  initializePayment
);
router.post(
  "/submit",
  submitPaymentValidation,
  validate,
  idempotency(),
  submitPayment
);

// Transaction management
router.get("/transactions", getTransactionHistory);
router.get("/transactions/:transactionId", getTransaction);
router.delete("/transactions/:transactionId", cancelTransaction);

// Refund & Dispute flow
router.post("/transactions/:id/refund-request", idempotency(), requestRefund);
router.post("/refunds/:refundId/build", idempotency(), buildRefundXdr);
router.post("/refunds/:refundId/submit", idempotency(), submitRefund);
router.post("/refunds/:refundId/reject", idempotency(), rejectRefund);
router.post("/refunds/:refundId/dispute", idempotency(), escalateDispute);
router.patch(
  "/refunds/:refundId/arbitrate",
  authorizeRoles("admin"),
  arbitrateDispute
);

// Admin reconciliation status
router.get(
  "/reconciliation/status",
  authorizeRoles("admin"),
  reconciliationStatus
);

// Fee-bump sponsorship status (admin) — sponsor float + today's spend (#30)
router.get(
  "/sponsorship/status",
  authorizeRoles("admin"),
  sponsorshipStatus
);

export default router;
