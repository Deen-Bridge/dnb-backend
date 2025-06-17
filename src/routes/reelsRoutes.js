import express from "express";
import { getReels, createReel } from "../controllers/reelController.js";
import { protect } from "../middlewares/authMiddleware.js";
import upload from "../middlewares/upload.js";

const router = express.Router();

router.get("/", getReels);
router.post("/", protect, upload.single("video"), createReel);

export default router;