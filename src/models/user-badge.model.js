import mongoose from "mongoose";

const userBadgeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    badge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Badge",
      required: true,
      index: true,
    },
    awardedAt: {
      type: Date,
      default: Date.now,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { timestamps: true }
);

userBadgeSchema.index({ user: 1, badge: 1 }, { unique: true });

export default mongoose.model("UserBadge", userBadgeSchema);
