import mongoose from "mongoose";

const userStreakSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    currentStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    longestStreak: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastActiveDate: {
      type: Date,
      default: null,
    },
    streakFreezes: {
      type: Number,
      default: 0,
      min: 0,
    },
    milestonesReached: [
      {
        milestone: { type: Number, required: true },
        reachedAt: { type: Date, default: Date.now },
      },
    ],
    activityHistory: [
      {
        date: { type: Date, required: true },
        activityType: { type: String, enum: ["reading", "video", "lesson", "general"], default: "general" },
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("UserStreak", userStreakSchema);
