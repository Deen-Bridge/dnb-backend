// routes/stellar/donationRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  initializeDonation,
  submitDonation,
  getDonationStats,
} from "../../controllers/stellar/donationController.js";

const router = express.Router();

// Public routes
router.get("/stats", getDonationStats);

// Protected routes (require authentication)
router.post("/initialize", protect, initializeDonation);
router.post("/submit", protect, submitDonation);

export default router;
