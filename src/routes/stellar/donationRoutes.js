// routes/stellar/donationRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  initializeDonation,
  submitDonation,
  getDonationStats,
} from "../../controllers/stellar/donationController.js";

const router = express.Router();

// Public routes
router.get("/stats", getDonationStats);

// Protected routes (require authentication)
router.post("/initialize", protect, idempotency(), initializeDonation);
router.post("/submit", protect, idempotency(), submitDonation);

export default router;
