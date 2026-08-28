import mongoose from "mongoose";

const pollOptionSchema = new mongoose.Schema(
  {
    optionIndex: { type: Number, required: true },
    text: { type: String, required: true, trim: true },
  },
  { _id: false }
);

const spacePollSchema = new mongoose.Schema(
  {
    space: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Space",
      required: true,
      index: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    question: {
      type: String,
      required: true,
      trim: true,
    },
    options: {
      type: [pollOptionSchema],
      required: true,
      validate: [
        (opts) => opts && opts.length >= 2,
        "Poll must have at least 2 options",
      ],
    },
    status: {
      type: String,
      enum: ["active", "closed"],
      default: "active",
      index: true,
    },
    closedAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model("SpacePoll", spacePollSchema);
