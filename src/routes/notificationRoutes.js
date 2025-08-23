import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  sseNotifications,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getNotificationSettings,
} from "../controllers/notificationController.js";

const router = express.Router();

// SSE endpoint for real-time notifications
router.get("/sse", protect, sseNotifications);

// Get user notifications
router.get("/", protect, getUserNotifications);

// Mark notification as read
router.put("/:notificationId/read", protect, markNotificationAsRead);

// Mark all notifications as read
router.put("/mark-all-read", protect, markAllNotificationsAsRead);

// Delete notification
router.delete("/:notificationId", protect,deleteNotification);

// Get notification settings
router.get("/settings", protect, getNotificationSettings);

export default router; 