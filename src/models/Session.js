// models/Session.js
import mongoose from "mongoose";

const sessionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
    },
    family: {
      type: String, // UUID
      required: true,
      index: true,
    },
    device: {
      userAgent: String,
      ip: String,
      label: String,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    replacedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Session",
      default: null,
    },
    lastUsedAt: {
      type: Date,
      default: Date.now,
    },
    is2FAVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

// TTL index on expiresAt. Mongo cleans this up lazily.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Session", sessionSchema);
