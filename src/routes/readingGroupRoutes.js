import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  createGroup,
  getGroups,
  getGroupDetails,
  joinGroup,
  inviteMember,
  updateSchedule,
  addDiscussionPost,
  getDiscussions,
  updateMemberProgress,
  getMemberProgressDashboard,
} from "../controllers/reading-group.controller.js";

const router = express.Router();

router.post("/", protect, createGroup);
router.get("/", protect, getGroups);
router.get("/:id", protect, getGroupDetails);
router.post("/:id/join", protect, joinGroup);
router.post("/:id/invite", protect, inviteMember);
router.put("/:id/schedule", protect, updateSchedule);
router.post("/:id/discussions", protect, addDiscussionPost);
router.get("/:id/discussions", protect, getDiscussions);
router.put("/:id/progress", protect, updateMemberProgress);
router.get("/:id/dashboard", protect, getMemberProgressDashboard);

export default router;
