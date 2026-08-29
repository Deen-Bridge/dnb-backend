// routes/hashtagRoutes.js — Issue #212
import express from "express";
import { getTrending, getReelsByTag } from "../controllers/hashtagController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// GET /api/hashtags/trending — top trending hashtags (explore page)
router.get("/trending", protect, getTrending);

// GET /api/hashtags/:tag/reels — all reels using a specific hashtag
router.get("/:tag/reels", protect, getReelsByTag);

export default router;
