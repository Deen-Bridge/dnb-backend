import mongoose from "mongoose";
import Notification from "../models/Notification.js";
import logger from "../config/logger.js";
import {
  recordEvent,
  getMetrics,
  metricsToCsv,
} from "../services/notificationAnalytics.service.js";

export const trackEvent = async (req, res) => {
  try {
    const { notificationId, event, channel } = req.body || {};
    if (!["opened", "clicked"].includes(event)) {
      return res
        .status(400)
        .json({ success: false, message: "event must be 'opened' or 'clicked'" });
    }
    if (!mongoose.Types.ObjectId.isValid(notificationId)) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid notificationId" });
    }
    const notification = await Notification.findOne({
      _id: notificationId,
      recipient: req.user._id,
    }).select("type");
    if (!notification) {
      return res
        .status(404)
        .json({ success: false, message: "Notification not found" });
    }
    await recordEvent({
      notificationId: notification._id,
      userId: req.user._id,
      type: notification.type,
      channel,
      event,
    });
    res.status(201).json({ success: true });
  } catch (error) {
    logger.error("Error tracking notification event:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

export const getNotificationMetrics = async (req, res) => {
  try {
    const { from, to, format } = req.query;
    if ((from && isNaN(new Date(from))) || (to && isNaN(new Date(to)))) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid from/to date" });
    }
    const metrics = await getMetrics({ from, to });
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        'attachment; filename="notification-analytics.csv"'
      );
      return res.send(metricsToCsv(metrics));
    }
    res.json({ success: true, data: metrics });
  } catch (error) {
    logger.error("Error fetching notification metrics:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
