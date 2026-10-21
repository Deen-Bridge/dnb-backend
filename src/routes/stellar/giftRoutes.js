// routes/stellar/giftRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  initializeGift,
  submitGift,
  listGifts,
  getGift,
  claimInitialize,
  claimSubmit,
} from "../../controllers/stellar/giftController.js";

const router = express.Router();

// All gift routes require authentication.
router.use(protect);

// Gift flow (sender funds a claimable balance for the recipient)
router.post("/initialize", idempotency(), initializeGift);
router.post("/submit", idempotency(), submitGift);

// Gift listing / detail
router.get("/", listGifts);
router.get("/:id", getGift);

// Claim / reclaim flow
router.post("/:id/claim/initialize", idempotency(), claimInitialize);
router.post("/:id/claim/submit", idempotency(), claimSubmit);

export default router;
