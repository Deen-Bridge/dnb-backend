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

import { validate } from "../../middlewares/validate.js";
import {
  initializeGiftValidation,
  submitGiftValidation,
  giftClaimInitializeValidation,
  giftClaimSubmitValidation,
} from "../../validators/paymentValidators.js";

const router = express.Router();

// All gift routes require authentication.
router.use(protect);

// Gift flow (sender funds a claimable balance for the recipient)
router.post("/initialize", initializeGiftValidation, validate, idempotency(), initializeGift);
router.post("/submit", submitGiftValidation, validate, idempotency(), submitGift);

// Gift listing / detail
router.get("/", listGifts);
router.get("/:id", giftClaimInitializeValidation, validate, getGift);

// Claim / reclaim flow
router.post("/:id/claim/initialize", giftClaimInitializeValidation, validate, idempotency(), claimInitialize);
router.post("/:id/claim/submit", giftClaimSubmitValidation, validate, idempotency(), claimSubmit);

export default router;
