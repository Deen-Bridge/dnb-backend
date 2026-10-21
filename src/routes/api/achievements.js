import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import Achievement from "../../models/achievement.model.js";
import { evaluateUser, getLeaderboard, seedAchievements } from "../../services/gamification.js";

const router = express.Router();
router.get("/", async (_req, res) => { await seedAchievements(); res.json({ success: true, data: await Achievement.find({}).sort({ category: 1, threshold: 1 }) }); });
router.get("/leaderboard", async (req, res) => { res.json({ success: true, data: await getLeaderboard(Number(req.query.limit) || 25) }); });
router.get("/me", protect, async (req, res) => { res.json({ success: true, data: await evaluateUser(req.user._id) }); });
router.post("/evaluate", protect, async (req, res) => { res.json({ success: true, data: await evaluateUser(req.user._id) }); });
router.get("/user/:userId", async (req, res) => { res.json({ success: true, data: await evaluateUser(req.params.userId) }); });
export default router;
