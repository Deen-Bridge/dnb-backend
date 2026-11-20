import mongoose from "mongoose";

const idempotencyKeySchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      trim: true,
    },
    operation: { type: String, required: true, trim: true },
    scope: { type: String, required: true, trim: true },
    requestHash: {
      type: String,
      required: true,
    },
    statusCode: {
      type: Number,
    },
    responseBody: {
      type: mongoose.Schema.Types.Mixed,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed"],
      default: "in_progress",
      index: true,
    },
    createdAt: {
      type: Date,
      default: Date.now,
      expires: 86400, // 24-hour TTL index
    },
  },
  { timestamps: true }
);

// Unique compound index on { key, userId, endpoint } for concurrency lock
// The key is globally owned so it cannot be replayed in another user or route
// context. Drop the previous compound index during deployment.
idempotencyKeySchema.index({ key: 1 }, { unique: true });

export default mongoose.model("IdempotencyKey", idempotencyKeySchema);
