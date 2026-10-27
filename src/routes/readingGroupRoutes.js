import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  createReadingGroupValidation,
  readingGroupIdValidation,
  inviteMemberValidation,
  discussionValidation,
  progressValidation,
  readingGroupQueryValidation,
} from "../validators/readingGroupValidators.js";
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

router.post("/", protect, createReadingGroupValidation, validate, createGroup);
router.get("/", protect, readingGroupQueryValidation, validate, getGroups);
router.get("/:id", protect, readingGroupIdValidation, validate, getGroupDetails);
router.post("/:id/join", protect, readingGroupIdValidation, validate, joinGroup);
router.post("/:id/invite", protect, readingGroupIdValidation, inviteMemberValidation, validate, inviteMember);
router.put("/:id/schedule", protect, readingGroupIdValidation, validate, updateSchedule);
router.post("/:id/discussions", protect, readingGroupIdValidation, discussionValidation, validate, addDiscussionPost);
router.get("/:id/discussions", protect, readingGroupIdValidation, validate, getDiscussions);
router.put("/:id/progress", protect, readingGroupIdValidation, progressValidation, validate, updateMemberProgress);
router.get("/:id/dashboard", protect, readingGroupIdValidation, validate, getMemberProgressDashboard);

export default router;
