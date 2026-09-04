import express from "express";
import { protect } from "../../../middlewares/authMiddleware.js";
import UserPreferences from "../../../models/UserPreferences.js";
import User from "../../../models/User.js";
import logger from "../../../config/logger.js";
import { emitPreferenceUpdate } from "../../../sockets/preferences.socket.js";
import { EventEmitter } from "events";

export const preferenceEvents = new EventEmitter();

const router = express.Router();

const ALLOWED_THEMES = ["light", "dark", "system"];
const ALLOWED_VISIBILITY = ["public", "private", "followers"];
const ALLOWED_MESSAGES = ["everyone", "followers", "none"];
const ALLOWED_FONT_SIZES = ["small", "medium", "large"];

export const validatePreferencesInput = (body) => {
  const errors = [];
  const updates = {};

  if (body.theme !== undefined) {
    if (!ALLOWED_THEMES.includes(body.theme)) {
      errors.push(`Invalid theme '${body.theme}'. Allowed: ${ALLOWED_THEMES.join(", ")}`);
    } else {
      updates.theme = body.theme;
    }
  }

  if (body.language !== undefined) {
    if (typeof body.language !== "string" || !body.language.trim()) {
      errors.push("Language must be a non-empty string");
    } else {
      updates.language = body.language.trim();
    }
  }

  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !body.timezone.trim()) {
      errors.push("Timezone must be a non-empty string");
    } else {
      updates.timezone = body.timezone.trim();
    }
  }

  if (body.fontSize !== undefined) {
    if (!ALLOWED_FONT_SIZES.includes(body.fontSize)) {
      errors.push(`Invalid fontSize '${body.fontSize}'. Allowed: ${ALLOWED_FONT_SIZES.join(", ")}`);
    } else {
      updates.fontSize = body.fontSize;
    }
  }

  if (body.notifications !== undefined) {
    if (typeof body.notifications !== "object" || body.notifications === null) {
      errors.push("Notifications must be an object");
    } else {
      const notificationFields = [
        "email",
        "push",
        "inApp",
        "marketing",
        "courseUpdates",
        "prayerReminders",
        "securityAlerts",
      ];
      updates.notifications = {};
      for (const field of notificationFields) {
        if (body.notifications[field] !== undefined) {
          if (typeof body.notifications[field] !== "boolean") {
            errors.push(`notifications.${field} must be a boolean`);
          } else {
            updates.notifications[field] = body.notifications[field];
          }
        }
      }
    }
  }

  if (body.privacy !== undefined) {
    if (typeof body.privacy !== "object" || body.privacy === null) {
      errors.push("Privacy must be an object");
    } else {
      updates.privacy = {};
      if (body.privacy.profileVisibility !== undefined) {
        if (!ALLOWED_VISIBILITY.includes(body.privacy.profileVisibility)) {
          errors.push(
            `Invalid privacy.profileVisibility '${body.privacy.profileVisibility}'. Allowed: ${ALLOWED_VISIBILITY.join(", ")}`
          );
        } else {
          updates.privacy.profileVisibility = body.privacy.profileVisibility;
        }
      }
      if (body.privacy.allowMessagesFrom !== undefined) {
        if (!ALLOWED_MESSAGES.includes(body.privacy.allowMessagesFrom)) {
          errors.push(
            `Invalid privacy.allowMessagesFrom '${body.privacy.allowMessagesFrom}'. Allowed: ${ALLOWED_MESSAGES.join(", ")}`
          );
        } else {
          updates.privacy.allowMessagesFrom = body.privacy.allowMessagesFrom;
        }
      }
      const booleanPrivacyFields = ["showActivity", "showLearningProgress", "showInLeaderboards"];
      for (const field of booleanPrivacyFields) {
        if (body.privacy[field] !== undefined) {
          if (typeof body.privacy[field] !== "boolean") {
            errors.push(`privacy.${field} must be a boolean`);
          } else {
            updates.privacy[field] = body.privacy[field];
          }
        }
      }
    }
  }

  return { errors, updates };
};

/**
 * @route   GET /api/users/me/preferences
 * @route   GET /api/users/preferences
 * @desc    Get current authenticated user's preferences
 * @access  Private
 */
export const getUserPreferences = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please authenticate.",
        data: null,
      });
    }

    let preferences = await UserPreferences.findOne({ user: userId });
    if (!preferences) {
      preferences = await UserPreferences.create({ user: userId });
    }

    return res.status(200).json({
      success: true,
      message: "User preferences retrieved successfully",
      data: preferences,
    });
  } catch (error) {
    logger.error("Get user preferences error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch user preferences",
      error: error.message,
    });
  }
};

/**
 * @route   PUT /api/users/me/preferences
 * @route   PUT /api/users/preferences
 * @desc    Update current authenticated user's preferences
 * @access  Private
 */
export const updateUserPreferences = async (req, res) => {
  try {
    const userId = req.user?._id || req.user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Unauthorized. Please authenticate.",
        data: null,
      });
    }

    const { errors, updates } = validatePreferencesInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors,
        data: null,
      });
    }

    const updateQuery = {};
    if (updates.theme !== undefined) updateQuery.theme = updates.theme;
    if (updates.language !== undefined) updateQuery.language = updates.language;
    if (updates.timezone !== undefined) updateQuery.timezone = updates.timezone;
    if (updates.fontSize !== undefined) updateQuery.fontSize = updates.fontSize;

    if (updates.notifications) {
      for (const [k, v] of Object.entries(updates.notifications)) {
        updateQuery[`notifications.${k}`] = v;
      }
    }

    if (updates.privacy) {
      for (const [k, v] of Object.entries(updates.privacy)) {
        updateQuery[`privacy.${k}`] = v;
      }
    }

    const preferences = await UserPreferences.findOneAndUpdate(
      { user: userId },
      { $set: updateQuery },
      { new: true, upsert: true, runValidators: true }
    );

    if (updates.language) {
      await User.findByIdAndUpdate(userId, { language: updates.language }).catch((err) => {
        logger.warn("Failed to sync language to User profile:", err.message);
      });
    }

    emitPreferenceUpdate(userId.toString(), preferences.toObject());
    preferenceEvents.emit("updated", { userId: userId.toString(), preferences });

    return res.status(200).json({
      success: true,
      message: "User preferences updated successfully",
      data: preferences,
    });
  } catch (error) {
    logger.error("Update user preferences error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to update user preferences",
      error: error.message,
    });
  }
};

router.get("/me/preferences", protect, getUserPreferences);
router.put("/me/preferences", protect, updateUserPreferences);
router.get("/preferences", protect, getUserPreferences);
router.put("/preferences", protect, updateUserPreferences);
router.get("/me", protect, getUserPreferences);
router.put("/me", protect, updateUserPreferences);
router.get("/", protect, getUserPreferences);
router.put("/", protect, updateUserPreferences);

export default router;
