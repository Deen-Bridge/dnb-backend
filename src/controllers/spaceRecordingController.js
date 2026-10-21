// controllers/spaceRecordingController.js — Issue #207
import {
  startRecording,
  finaliseRecording,
  listRecordingsForSpace,
  getRecordingById,
  deleteRecording,
} from "../services/spaceRecordingService.js";
import logger from "../config/logger.js";

/**
 * POST /api/spaces/:spaceId/recordings
 * Start a recording for a live space session.
 * Body: { url, assetId, mimeType, fileSize, sessionStartedAt }
 */
export const startSpaceRecording = async (req, res, next) => {
  try {
    const recording = await startRecording(req.params.spaceId, req.user._id, req.body);
    res.status(201).json({ success: true, data: recording });
  } catch (err) {
    next(err);
  }
};

/**
 * PATCH /api/spaces/:spaceId/recordings/:recordingId/finalise
 * Mark a recording as ready with its final cloud URL and metadata.
 * Body: { url, assetId, duration, fileSize, sessionEndedAt }
 */
export const finaliseSpaceRecording = async (req, res, next) => {
  try {
    const recording = await finaliseRecording(req.params.recordingId, req.body);
    res.json({ success: true, data: recording });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/spaces/:spaceId/recordings
 * List ready recordings for a space (replay page).
 * Query: page, limit
 */
export const getSpaceRecordings = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await listRecordingsForSpace(req.params.spaceId, {
      page: Number(page),
      limit: Number(limit),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/spaces/:spaceId/recordings/:recordingId
 * Fetch a single recording for replay.
 */
export const getSpaceRecording = async (req, res, next) => {
  try {
    const recording = await getRecordingById(req.params.recordingId);
    res.json({ success: true, data: recording });
  } catch (err) {
    next(err);
  }
};

/**
 * DELETE /api/spaces/:spaceId/recordings/:recordingId
 * Delete a recording (host only).
 */
export const deleteSpaceRecording = async (req, res, next) => {
  try {
    await deleteRecording(req.params.recordingId, req.user._id);
    res.json({ success: true, message: "Recording deleted" });
  } catch (err) {
    next(err);
  }
};
