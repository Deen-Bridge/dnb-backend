// routes/spaceRecordingRoutes.js — Issue #207
import express from "express";
import {
  startSpaceRecording,
  finaliseSpaceRecording,
  getSpaceRecordings,
  getSpaceRecording,
  deleteSpaceRecording,
} from "../controllers/spaceRecordingController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router({ mergeParams: true });

// All recording endpoints require authentication.
router.use(protect);

// List all ready recordings for a space (replay page).
router.get("/", getSpaceRecordings);

// Start a new recording (host initiates from WebRTC session).
router.post("/", startSpaceRecording);

// Fetch a single recording for replay / download.
router.get("/:recordingId", getSpaceRecording);

// Finalise a recording — called by the media pipeline when upload is done.
router.patch("/:recordingId/finalise", finaliseSpaceRecording);

// Delete a recording (host only).
router.delete("/:recordingId", deleteSpaceRecording);

export default router;
