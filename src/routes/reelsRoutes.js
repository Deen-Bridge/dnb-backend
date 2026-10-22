import express from "express";
import {
  getReels,
  getReelById,
  createReel,
  reactToReel,
  addReelComment,
  getReelComments,
  deleteReelComment,
  registerReelShare,
  registerReelView,
  createReelDuet,
  getReelDerivatives,
} from "../controllers/reelController.js";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";
import { validate } from "../middlewares/validate.js";
import {
  createReelDuetValidation,
  listReelDuetsValidation,
} from "../validators/reelValidators.js";

const router = express.Router();

router.get("/", protect, getReels);
router.get("/:id", protect, getReelById);
router.post("/", protect, upload.single("video"), createReel);
router.post("/:id/react", protect, reactToReel);
router.post("/:id/comments", protect, addReelComment);
router.get("/:id/comments", protect, getReelComments);
router.delete("/:id/comments/:commentId", protect, deleteReelComment);
router.post("/:id/share", protect, registerReelShare);
router.post("/:id/view", protect, registerReelView);

// Duet / stitch: create a response video linked to the original reel and
// browse all duets/stitches for a given reel.
router.post(
  "/:id/duet",
  protect,
  upload.single("video"),
  createReelDuetValidation,
  validate,
  createReelDuet
);
router.get(
  "/:id/duets",
  protect,
  listReelDuetsValidation,
  validate,
  getReelDerivatives
);

import { flagReel } from "../controllers/moderation.controller.js";

router.post("/:reelId/flag", protect, flagReel);

export default router;