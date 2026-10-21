// routes/stellar/donationRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  initializeDonation,
  submitDonation,
  getDonationStats,
} from "../../controllers/stellar/donationController.js";

import { validate } from "../../middlewares/validate.js";
import {
  initializeDonationValidation,
  submitDonationValidation,
} from "../../validators/paymentValidators.js";

const router = express.Router();

// Public routes
router.get("/stats", getDonationStats);

// Protected routes (require authentication)
router.post("/initialize", protect, initializeDonationValidation, validate, idempotency(), initializeDonation);
router.post("/submit", protect, submitDonationValidation, validate, idempotency(), submitDonation);

export default router;
