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
  { timestamps: true }
);

export default mongoose.model("ContentFlag", contentFlagSchema);
