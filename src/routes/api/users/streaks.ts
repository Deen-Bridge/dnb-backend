import express from "express";
import { getStreakStatus, useStreakFreeze, recordActivity } from "../../../services/streakTracker.js";
import authMiddleware from "../../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", authMiddleware, async (req: any, res: any) => {
  try {
    const status = await getStreakStatus(req.user.id || req.user._id);
    return res.json({ success: true, data: status });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/activity", authMiddleware, async (req: any, res: any) => {
  try {
    const { activityType } = req.body;
    const streak = await recordActivity(req.user.id || req.user._id, activityType);
    return res.json({ success: true, data: streak });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

router.post("/freeze", authMiddleware, async (req: any, res: any) => {
  try {
    const streak = await useStreakFreeze(req.user.id || req.user._id);
    return res.json({ success: true, data: streak });
  } catch (error: any) {
    return res.status(400).json({ success: false, message: error.message });
  }
});

export default router;
