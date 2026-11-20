// routes/payoutRoutes.js
import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { authorizePayout, PAYOUT_CAPABILITIES } from "../security/payoutPolicy.js";
import { idempotency } from "../middlewares/idempotency.js";
import {
  buildBatch,
  submitBatch,
  getMyBalance,
  getMyStatement,
  getMyHistory,
} from "../controllers/payoutController.js";

import { validate } from "../middlewares/validate.js";
import {
  buildPayoutValidation,
  submitPayoutValidation,
} from "../validators/paymentValidators.js";

const router = express.Router();

// All routes require authentication
router.use(protect);

// Educator endpoints
router.get("/me/balance", authorizePayout(PAYOUT_CAPABILITIES.READ_OWN), getMyBalance);
router.get("/me/statement", authorizePayout(PAYOUT_CAPABILITIES.READ_OWN), getMyStatement);
router.get("/me/history", authorizePayout(PAYOUT_CAPABILITIES.READ_OWN), getMyHistory);

// Mutating capabilities are centrally defined and kept separate: building
// initiates a payout, while submitting signed XDRs executes one.
router.post(
  "/build",
  authorizePayout(PAYOUT_CAPABILITIES.INITIATE),
  buildPayoutValidation,
  validate,
  idempotency(),
  buildBatch
);
router.post(
  "/:batchId/submit",
  authorizePayout(PAYOUT_CAPABILITIES.EXECUTE),
  submitPayoutValidation,
  validate,
  idempotency(),
  submitBatch
);

export default router;
