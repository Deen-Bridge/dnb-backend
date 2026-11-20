import mongoose from "mongoose";

const privacyRequestSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    type: { type: String, enum: ["export", "delete"], required: true },
    requestKey: { type: String, required: true },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "partial", "failed"],
      default: "queued",
      index: true,
    },
    completedSteps: { type: [String], default: [] },
    failedSteps: { type: [String], default: [] },
    progress: { type: Number, min: 0, max: 100, default: 0 },
    archive: {
      encrypted: { type: Boolean, default: false },
      expiresAt: { type: Date, default: null },
      consumedAt: { type: Date, default: null },
      data: { type: mongoose.Schema.Types.Mixed, default: null, select: false },
    },
    error: { type: String, default: null },
    requestedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

privacyRequestSchema.index({ user: 1, type: 1, requestKey: 1 }, { unique: true });

export default mongoose.model("PrivacyRequest", privacyRequestSchema);
