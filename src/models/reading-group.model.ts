import mongoose from "mongoose";

const scheduleItemSchema = new mongoose.Schema(
  {
    chapter: { type: Number, required: true },
    title: { type: String, default: "" },
    targetPages: { type: String, default: "" },
    startDate: { type: Date },
    endDate: { type: Date },
  },
  { _id: false }
);

const discussionPostSchema = new mongoose.Schema(
  {
    chapter: { type: Number, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    content: { type: String, required: true, trim: true },
    createdAt: { type: Date, default: Date.now },
  }
);

const readingGroupSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      required: true,
      index: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    privacy: {
      type: String,
      enum: ["public", "private"],
      default: "public",
    },
    chaptersPerWeek: {
      type: Number,
      default: 1,
    },
    readingSchedule: [scheduleItemSchema],
    discussions: [discussionPostSchema],
  },
  { timestamps: true }
);

readingGroupSchema.index({ name: "text", description: "text" });

export default mongoose.model("ReadingGroup", readingGroupSchema);
