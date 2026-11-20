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
  { timestamps: true },
);

// Replayed decisions for the same flag/action are one audit event, not many.
// Actions without a flag (manual reel decisions) remain allowed.
moderationActionSchema.index(
  { flag: 1, action: 1 },
  {
    name: "one-moderation-action-per-flag",
    unique: true,
    partialFilterExpression: { flag: { $type: "objectId" } },
  },
);

export default mongoose.model("ModerationAction", moderationActionSchema);
