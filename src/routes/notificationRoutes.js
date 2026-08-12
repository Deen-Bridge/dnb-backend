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

// Accept token from query param (EventSource can't set custom headers)
const sseAuth = async (req, res, next) => {
  const token = req.query.token;
  if (!token) {
    return res.status(401).json({ success: false, message: "No token, authorization denied" });
  }
  req.headers.authorization = `Bearer ${token}`;
  protect(req, res, next);
};

// SSE endpoint for real-time notifications (uses query-param auth)
router.get("/sse", sseAuth, sseNotifications);

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