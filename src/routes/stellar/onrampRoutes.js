// routes/stellar/onrampRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  createOnrampSession,
  getOnrampTransactions,
  handleWebhook,
} from "../../controllers/stellar/onrampController.js";

const router = express.Router();

// Public webhook — authenticity is established by provider HMAC signature
// verification inside the handler (over req.rawBody), not by auth middleware.
router.post("/webhook", handleWebhook);

// Protected routes (require authentication)
router.post("/session", protect, createOnrampSession);
router.get("/transactions", protect, getOnrampTransactions);

export default router;
