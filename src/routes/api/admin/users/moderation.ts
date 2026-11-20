import express from "express";
import { protect, authorizeRoles } from "../../../../middlewares/authMiddleware.js";
import userModerationService from "../../../../services/userModeration.js";
import { catchAsync } from "../../../../middlewares/errorHandler.js";
import mongoose from "mongoose";
import rateLimit from "express-rate-limit";

const router = express.Router();
const moderationLogsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false, skip: () => process.env.NODE_ENV === "test" });

router.use(protect);
router.use(authorizeRoles("admin"));

router.post(
  "/suspend",
  catchAsync(async (req, res) => {
    const { userId, reason, durationDays } = req.body;
    const adminId = req.user._id;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const result = await userModerationService.suspendUser({
      adminId,
      userId,
      reason,
      durationDays,
      req,
    });

    res.status(200).json({
      success: true,
      message: "User suspended successfully",
      ...result,
    });
  })
);

router.post(
  "/ban",
  catchAsync(async (req, res) => {
    const { userId, reason } = req.body;
    const adminId = req.user._id;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const result = await userModerationService.banUser({
      adminId,
      userId,
      reason,
      req,
    });

    res.status(200).json({
      success: true,
      message: "User permanently banned successfully",
      ...result,
    });
  })
);

router.post(
  "/unban",
  catchAsync(async (req, res) => {
    const { userId, reason } = req.body;
    const adminId = req.user._id;

    if (!userId || !reason) {
      return res.status(400).json({
        success: false,
        message: "userId and reason are required",
      });
    }

    const result = await userModerationService.unbanUser({
      adminId,
      userId,
      reason,
      req,
    });

    res.status(200).json({
      success: true,
      message: "User unbanned successfully",
      ...result,
    });
  })
);

router.get(
  "/logs",
  moderationLogsLimiter,
  catchAsync(async (req, res) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const targetUser = req.query.targetUser as string;
    if (page < 1 || limit < 1 || limit > 100 || (targetUser && !mongoose.Types.ObjectId.isValid(targetUser))) {
      return res.status(400).json({ success: false, message: "Invalid pagination or targetUser filter" });
    }

    const result = await userModerationService.getModerationLogs({
      page,
      limit,
      targetUser,
    });

    res.status(200).json({
      success: true,
      ...result,
    });
  })
);

export default router;
