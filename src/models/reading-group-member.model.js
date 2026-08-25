import mongoose from "mongoose";

const readingGroupMemberSchema = new mongoose.Schema(
  {
    group: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ReadingGroup",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
    },
    status: {
      type: String,
      enum: ["active", "invited", "pending"],
      default: "active",
    },
    currentChapter: {
      type: Number,
      default: 1,
    },
    currentProgressPercent: {
      type: Number,
      default: 0,
    },
    lastReadDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

readingGroupMemberSchema.index({ group: 1, user: 1 }, { unique: true });

export default mongoose.model("ReadingGroupMember", readingGroupMemberSchema);
