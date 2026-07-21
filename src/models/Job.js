import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, index: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    idempotencyKey: { type: String, required: true, unique: true, index: true },
    status: {
      type: String,
      enum: ["queued", "active", "retrying", "completed", "dead"],
      default: "queued",
      index: true,
    },
    attemptsMade: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 1 },
    backoffMs: { type: Number, default: 1000 },
    runAt: { type: Date, default: Date.now, index: true },
    lockedAt: Date,
    completedAt: Date,
    failedAt: Date,
    lastError: String,
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, runAt: 1 });

export default mongoose.model("Job", jobSchema);
