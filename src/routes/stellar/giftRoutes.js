import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  initializeGift,
  submitGift,
  getGifts,
  getGift,
  initializeClaim,
  submitClaim,
} from "../../controllers/stellar/giftController.js";

const router = express.Router();

router.use(protect);

router.post("/initialize", initializeGift);
router.post("/submit", submitGift);
router.post("/claim/initialize", initializeClaim);
router.post("/claim/submit", submitClaim);
router.get("/", getGifts);
router.get("/:id", getGift);

export default router;
