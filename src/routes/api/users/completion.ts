import express, { Request, Response } from "express";
import { protect } from "../../../middlewares/authMiddleware.js";
import User from "../../../models/User.js";
import logger from "../../../config/logger.js";
import {
  calculateProfileCompletion,
  DEFAULT_PROFILE_FIELDS,
  getCompletionLevel,
} from "../../../utils/profileCompletion.js";

const router = express.Router();

/**
 * @route   GET /api/users/completion
 * @route   GET /api/users/completion/me
 * @desc    Get current authenticated user's profile completion metrics and recommendations
 * @access  Private
 */
export const getMyCompletion = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user?._id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please authenticate.",
        data: null,
      });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    const completion = calculateProfileCompletion(user);

    return res.status(200).json({
      success: true,
      message: "Profile completion fetched successfully",
      data: {
        userId: user._id,
        ...completion,
      },
    });
  } catch (error: any) {
    logger.error("Get my profile completion error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate profile completion",
      error: error.message,
    });
  }
};

/**
 * @route   GET /api/users/completion/criteria
 * @desc    Get scoring criteria, weights, and levels for profile completion
 * @access  Public / Private
 */
export const getCompletionCriteria = (_req: Request, res: Response) => {
  try {
    const fields = DEFAULT_PROFILE_FIELDS.map((f) => ({
      key: f.key,
      label: f.label,
      weight: f.weight,
      category: f.category,
      suggestion: f.suggestion,
    }));

    const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);

    return res.status(200).json({
      success: true,
      message: "Profile completion criteria retrieved successfully",
      data: {
        totalWeight,
        fields,
        levels: {
          Beginner: "0-34%",
          Intermediate: "35-69%",
          Advanced: "70-99%",
          Complete: "100%",
        },
      },
    });
  } catch (error: any) {
    logger.error("Get completion criteria error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to retrieve completion criteria",
      error: error.message,
    });
  }
};

/**
 * @route   GET /api/users/completion/:userId
 * @desc    Get profile completion metrics for a specific user
 * @access  Private
 */
export const getUserCompletion = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUserId = (req as any).user?._id?.toString();
    const isAdmin = (req as any).user?.role === "admin";
    const isSelf = currentUserId === userId;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
        data: null,
      });
    }

    // For other users (non-admin), evaluate based on public profile info
    let fieldsToEvaluate = DEFAULT_PROFILE_FIELDS;
    if (!isSelf && !isAdmin) {
      fieldsToEvaluate = DEFAULT_PROFILE_FIELDS.filter(
        (f) => f.key !== "twoFactor"
      );
    }

    const completion = calculateProfileCompletion(user, fieldsToEvaluate);

    return res.status(200).json({
      success: true,
      message: "User profile completion fetched successfully",
      data: {
        userId: user._id,
        isSelf,
        ...completion,
      },
    });
  } catch (error: any) {
    logger.error("Get user profile completion error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate user profile completion",
      error: error.message,
    });
  }
};

// Route definitions
router.get("/criteria", getCompletionCriteria);
router.get("/me", protect, getMyCompletion);
router.get("/", protect, getMyCompletion);
router.get("/:userId", protect, getUserCompletion);

export default router;
