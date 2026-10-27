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
import { validate, sanitizeInput } from "../middlewares/validate.js";
import {
  createReelDuetValidation,
  listReelDuetsValidation,
  reelIdValidation,
  listReelsValidation,
  createReelValidation,
  reactToReelValidation,
  addReelCommentValidation,
  listReelCommentsValidation,
  deleteReelCommentValidation,
  flagReelValidation,
} from "../validators/reelValidators.js";

const router = express.Router();

router.get("/", protect, listReelsValidation, validate, getReels);
router.get("/:id", protect, reelIdValidation, validate, getReelById);
router.post(
  "/",
  protect,
  upload.single("video"),
  sanitizeInput,
  createReelValidation,
  validate,
  createReel
);
router.post(
  "/:id/react",
  protect,
  reactToReelValidation,
  validate,
  reactToReel
);
router.post(
  "/:id/comments",
  protect,
  sanitizeInput,
  addReelCommentValidation,
  validate,
  addReelComment
);
router.get(
  "/:id/comments",
  protect,
  listReelCommentsValidation,
  validate,
  getReelComments
);
router.delete(
  "/:id/comments/:commentId",
  protect,
  deleteReelCommentValidation,
  validate,
  deleteReelComment
);
router.post("/:id/share", protect, reelIdValidation, validate, registerReelShare);
router.post("/:id/view", protect, reelIdValidation, validate, registerReelView);

// Duet / stitch: create a response video linked to the original reel and
// browse all duets/stitches for a given reel.
router.post(
  "/:id/duet",
  protect,
  upload.single("video"),
  sanitizeInput,
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

router.post(
  "/:reelId/flag",
  protect,
  sanitizeInput,
  flagReelValidation,
  validate,
  flagReel
);

export default router;