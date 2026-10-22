import express from "express";
import { protect, authorizeRoles } from "../middlewares/authMiddleware.js";
import { bulkNotificationLimiter } from "../middlewares/security.js";
import {
  sseNotifications,
  getUserNotifications,
  markNotificationAsRead,
  markAllNotificationsAsRead,
  deleteNotification,
  getNotificationSettings,
  sendBulkNotification,
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

// Bulk notification for course (mentor/admin only)
router.post(
  "/bulk",
  protect,
  authorizeRoles("mentor", "admin"),
  bulkNotificationLimiter,
  sendBulkNotification
);

export default router; 