// routes/stellar/giftRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
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
router.post("/initialize", initializeGift);
router.post("/submit", submitGift);

// Gift listing / detail
router.get("/", listGifts);
router.get("/:id", getGift);

// Claim / reclaim flow
router.post("/:id/claim/initialize", claimInitialize);
router.post("/:id/claim/submit", claimSubmit);

export default router;
