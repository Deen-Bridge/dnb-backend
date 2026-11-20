import mongoose from "mongoose";

const contentFlagSchema = new mongoose.Schema(
  {
    reel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
      index: true,
    },
    reporter: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    details: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "removed"],
      default: "pending",
      index: true,
    },
    isAutoFlagged: {
      type: Boolean,
      default: false,
    },
    flaggedKeywords: [{ type: String }],
  },
  { timestamps: true },
);

// Keep at most one active report for a reporter/reel pair. Resolved reports
// remain as audit history and may be re-opened with a new pending record.
contentFlagSchema.index(
  { reel: 1, reporter: 1, status: 1 },
  {
    name: "one-pending-flag-per-reporter-reel",
    unique: true,
    partialFilterExpression: {
      status: "pending",
      reporter: { $type: "objectId" },
    },
  },
);

export default mongoose.model("ContentFlag", contentFlagSchema);
