import mongoose from "mongoose";

const moderationLogSchema = new mongoose.Schema(
  {
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    targetUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["suspend", "ban", "unban"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
    },
    suspendedUntil: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ModerationLog", moderationLogSchema);
