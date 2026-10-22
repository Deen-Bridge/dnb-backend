// services/spaceRecordingService.js — Issue #207
import SpaceRecording from "../models/SpaceRecording.js";
import Space from "../models/Space.js";
import cloudinary from "../utils/cloudinary.js";
import logger from "../config/logger.js";

/**
 * Start a new recording entry for a live space session.
 *
 * In a real media pipeline the caller would supply the cloud-storage URL
 * returned by a WebRTC recorder. Here we create the document immediately
 * with status "processing" so the front-end can track it.
 *
 * @param {string} spaceId   - Space._id being recorded
 * @param {string} userId    - User._id initiating the recording
 * @param {object} payload   - { url, assetId, mimeType, fileSize, sessionStartedAt }
 */
export const startRecording = async (spaceId, userId, payload = {}) => {
  const space = await Space.findById(spaceId);
  if (!space) {
    const err = new Error("Space not found");
    err.statusCode = 404;
    throw err;
  }

  const recording = await SpaceRecording.create({
    space: spaceId,
    recordedBy: userId,
    url: payload.url ?? "",
    assetId: payload.assetId,
    mimeType: payload.mimeType ?? "video/mp4",
    fileSize: payload.fileSize ?? 0,
    sessionStartedAt: payload.sessionStartedAt ?? new Date(),
    status: "processing",
  });

  logger.info({ recordingId: recording._id, spaceId }, "Space recording started");
  return recording;
};

/**
 * Finalise a recording — mark it ready and store the playback URL.
 *
 * @param {string} recordingId
 * @param {object} updates - { url, assetId, duration, fileSize, sessionEndedAt }
 */
export const finaliseRecording = async (recordingId, updates = {}) => {
  const recording = await SpaceRecording.findById(recordingId);
  if (!recording) {
    const err = new Error("Recording not found");
    err.statusCode = 404;
    throw err;
  }

  Object.assign(recording, {
    ...updates,
    status: "ready",
    sessionEndedAt: updates.sessionEndedAt ?? new Date(),
  });

  await recording.save();
  logger.info({ recordingId }, "Space recording finalised");
  return recording;
};

/**
 * List all ready recordings for a given space.
 *
 * @param {string} spaceId
 * @param {object} options - { page, limit }
 */
export const listRecordingsForSpace = async (spaceId, { page = 1, limit = 20 } = {}) => {
  const skip = (page - 1) * limit;

  const [recordings, total] = await Promise.all([
    SpaceRecording.find({ space: spaceId, status: "ready" })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("recordedBy", "name avatar"),
    SpaceRecording.countDocuments({ space: spaceId, status: "ready" }),
  ]);

  return { recordings, total, page, limit };
};

/**
 * Fetch a single recording by ID.
 *
 * @param {string} recordingId
 */
export const getRecordingById = async (recordingId) => {
  const recording = await SpaceRecording.findById(recordingId)
    .populate("recordedBy", "name avatar")
    .populate("space", "title description");

  if (!recording) {
    const err = new Error("Recording not found");
    err.statusCode = 404;
    throw err;
  }

  return recording;
};

/**
 * Delete a recording and remove the media asset from Cloudinary if present.
 *
 * @param {string} recordingId
 * @param {string} requesterId  - must match recording.recordedBy
 */
export const deleteRecording = async (recordingId, requesterId) => {
  const recording = await SpaceRecording.findById(recordingId);
  if (!recording) {
    const err = new Error("Recording not found");
    err.statusCode = 404;
    throw err;
  }

  if (recording.recordedBy.toString() !== requesterId.toString()) {
    const err = new Error("Not authorised to delete this recording");
    err.statusCode = 403;
    throw err;
  }

  // Remove from Cloudinary if we stored the public_id.
  if (recording.assetId) {
    try {
      await cloudinary.uploader.destroy(recording.assetId, { resource_type: "video" });
    } catch (cloudErr) {
      logger.warn({ cloudErr, assetId: recording.assetId }, "Cloudinary delete failed, proceeding");
    }
  }

  await recording.deleteOne();
  logger.info({ recordingId }, "Space recording deleted");
};
