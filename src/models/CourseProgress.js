import mongoose from "mongoose";

const courseProgressSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    lessonsCompleted: [{ type: mongoose.Schema.Types.ObjectId }],
    lastLesson: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    lastPositionSeconds: {
      type: Number,
      default: 0,
    },
    percentComplete: {
      type: Number,
      default: 0,
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

courseProgressSchema.index({ user: 1, course: 1 }, { unique: true });

export default mongoose.model("CourseProgress", courseProgressSchema);
