import express from "express";
import { protect, authorizeRoles } from "../../../../middlewares/authMiddleware.js";
import userModerationService from "../../../../services/userModeration.js";
import { catchAsync } from "../../../../middlewares/errorHandler.js";

const router = express.Router();

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
  catchAsync(async (req, res) => {
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;
    const targetUser = req.query.targetUser as string;

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
