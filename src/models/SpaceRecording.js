// models/SpaceRecording.js — Issue #207
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * SpaceRecording stores metadata for a recorded live-space session.
 * The actual media asset lives in cloud storage; this document tracks
 * the reference, status, and playback details.
 */
const spaceRecordingSchema = new Schema(
  {
    /** The space whose session was recorded. */
    space: {
      type: Schema.Types.ObjectId,
      ref: "Space",
      required: true,
      index: true,
    },
    /** User (host) who initiated the recording. */
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    /** Cloudinary / S3 public URL for the recording. */
    url: {
      type: String,
      required: true,
    },
    /** Cloud-storage provider asset ID / public_id for deletion. */
    assetId: {
      type: String,
    },
    /** Duration of the recording in seconds. */
    duration: {
      type: Number,
      default: 0,
    },
    /** File size in bytes (informational). */
    fileSize: {
      type: Number,
      default: 0,
    },
    /** MIME type, e.g. "video/mp4". */
    mimeType: {
      type: String,
      default: "video/mp4",
    },
    /** Processing / availability status. */
    status: {
      type: String,
      enum: ["processing", "ready", "failed"],
      default: "processing",
    },
    /** Whether the recording is available for public replay. */
    isPublic: {
      type: Boolean,
      default: true,
    },
    /** Signed download URL (short-lived, regenerated on demand). */
    downloadUrl: {
      type: String,
    },
    /** When the live session that was recorded started. */
    sessionStartedAt: {
      type: Date,
    },
    /** When the live session ended. */
    sessionEndedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Speed up listing all recordings for a space (replay page).
spaceRecordingSchema.index({ space: 1, createdAt: -1 });

const SpaceRecording = mongoose.model("SpaceRecording", spaceRecordingSchema);

export default SpaceRecording;
