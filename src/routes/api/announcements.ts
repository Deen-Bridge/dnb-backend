import express from "express";
import Announcement from "../../models/Announcement.js";
import { authMiddleware } from "../../middlewares/authMiddleware.js";

const router = express.Router();

// GET /api/announcements - Get active published announcements for current user
router.get("/", authMiddleware, async (req, res, next) => {
  try {
    const now = new Date();
    const query = {
      status: "published",
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }],
    };

    const announcements = await Announcement.find(query).sort({ priority: -1, createdAt: -1 });
    res.json({ success: true, data: announcements });
  } catch (error) {
    next(error);
  }
});

// POST /api/announcements/:id/acknowledge - Acknowledge an announcement
router.post("/:id/acknowledge", authMiddleware, async (req, res, next) => {
  try {
    const userId = (req as any).user._id;
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    if (announcement.status !== "published") {
      return res.status(400).json({ success: false, message: "Announcement is not active" });
    }

    if (!announcement.acknowledgments.includes(userId)) {
      announcement.acknowledgments.push(userId);
      await announcement.save();
    }

    res.json({ success: true, message: "Announcement acknowledged successfully" });
  } catch (error) {
    next(error);
  }
});

export default router;
