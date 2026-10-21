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
import {
  quoteValidation,
  preflightValidation,
  pathPaymentValidation,
  transactionIdParamValidation,
  requestRefundValidation,
  refundIdParamValidation,
  submitRefundValidation,
  rejectRefundValidation,
  arbitrateDisputeValidation,
} from "../../validators/paymentValidators.js";


const router = express.Router();

// All routes require authentication
router.use(protect);

// Payment flow
router.post("/quote", quoteValidation, validate, getQuote);
router.post("/preflight", preflightValidation, validate, getPaymentPreflight);
router.post(
  "/initialize",
  initializePaymentValidation,
  pathPaymentValidation,
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
router.get("/transactions/:transactionId", transactionIdParamValidation, validate, getTransaction);
router.delete(
  "/transactions/:transactionId",
  transactionIdParamValidation,
  validate,
  idempotency(),
  cancelTransaction
);

// Refund & Dispute flow
router.post("/transactions/:id/refund-request", requestRefundValidation, validate, idempotency(), requestRefund);
router.post("/refunds/:refundId/build", refundIdParamValidation, validate, idempotency(), buildRefundXdr);
router.post("/refunds/:refundId/submit", submitRefundValidation, validate, idempotency(), submitRefund);
router.post("/refunds/:refundId/reject", rejectRefundValidation, validate, idempotency(), rejectRefund);
router.post("/refunds/:refundId/dispute", refundIdParamValidation, validate, idempotency(), escalateDispute);
router.patch(
  "/refunds/:refundId/arbitrate",
  authorizeRoles("admin"),
  arbitrateDisputeValidation,
  validate,
  idempotency(),
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
