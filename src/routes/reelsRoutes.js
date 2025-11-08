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
} from "../controllers/reelController.js";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";

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

export default router;