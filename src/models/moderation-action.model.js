import mongoose from "mongoose";

const moderationActionSchema = new mongoose.Schema(
  {
    flag: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ContentFlag",
      index: true,
    },
    reel: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Reel",
      required: true,
      index: true,
    },
    admin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["approve", "reject", "remove"],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

export default mongoose.model("ModerationAction", moderationActionSchema);
