import express from "express";
import Announcement from "../../../models/Announcement.js";
import { authMiddleware } from "../../../middlewares/authMiddleware.js";
import { authorize } from "../../../middlewares/authorize.js";

const router = express.Router();

// All admin announcement routes require authentication and admin role
router.use(authMiddleware);
router.use(authorize("admin"));

// GET /api/admin/announcements - List all announcements
router.get("/", async (req, res, next) => {
  try {
    const { status, type, page = 1, limit = 20 } = req.query;
    const query: any = {};
    if (status) query.status = status;
    if (type) query.type = type;

    const skip = (Number(page) - 1) * Number(limit);
    const [announcements, total] = await Promise.all([
      Announcement.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit))
        .populate("createdBy", "name email"),
      Announcement.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: announcements,
      pagination: {
        total,
        page: Number(page),
        limit: Number(limit),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/announcements - Create an announcement
router.post("/", async (req, res, next) => {
  try {
    const { title, message, type, priority, status, scheduledFor, expiresAt } = req.body;

    if (!title || !message) {
      return res.status(400).json({ success: false, message: "Title and message are required" });
    }

    const announcementData: any = {
      title,
      message,
      type: type || "info",
      priority: priority || "medium",
      status: status || "draft",
      createdBy: (req as any).user._id,
    };

    if (scheduledFor) announcementData.scheduledFor = new Date(scheduledFor);
    if (expiresAt) announcementData.expiresAt = new Date(expiresAt);

    // If scheduledFor is set and in the future and status is not draft/archived, set to scheduled
    if (announcementData.status === "published" && announcementData.scheduledFor && new Date(announcementData.scheduledFor) > new Date()) {
      announcementData.status = "scheduled";
    }

    const announcement = await Announcement.create(announcementData);
    res.status(201).json({ success: true, data: announcement });
  } catch (error) {
    next(error);
  }
});

// PUT /api/admin/announcements/:id - Update an announcement
router.put("/:id", async (req, res, next) => {
  try {
    const { title, message, type, priority, status, scheduledFor, expiresAt } = req.body;
    const announcement = await Announcement.findById(req.params.id);

    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }

    if (title !== undefined) announcement.title = title;
    if (message !== undefined) announcement.message = message;
    if (type !== undefined) announcement.type = type;
    if (priority !== undefined) announcement.priority = priority;
    if (status !== undefined) announcement.status = status;
    if (scheduledFor !== undefined) announcement.scheduledFor = scheduledFor ? new Date(scheduledFor) : undefined;
    if (expiresAt !== undefined) announcement.expiresAt = expiresAt ? new Date(expiresAt) : undefined;

    await announcement.save();
    res.json({ success: true, data: announcement });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/announcements/:id - Delete an announcement
router.delete("/:id", async (req, res, next) => {
  try {
    const announcement = await Announcement.findByIdAndDelete(req.params.id);
    if (!announcement) {
      return res.status(404).json({ success: false, message: "Announcement not found" });
    }
    res.json({ success: true, message: "Announcement deleted successfully" });
  } catch (error) {
    next(error);
  }
});

export default router;
