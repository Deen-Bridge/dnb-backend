import mongoose from "mongoose";

const reelEngagementSchema = new mongoose.Schema(
  {
    reel: { type: mongoose.Schema.Types.ObjectId, ref: "Reel", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["share", "view"], required: true },
  },
  { timestamps: true }
);

// One durable event per authenticated user, reel, and counter. Retries and
// concurrent requests therefore cannot inflate either metric.
reelEngagementSchema.index({ reel: 1, user: 1, kind: 1 }, { unique: true });

export default mongoose.model("ReelEngagement", reelEngagementSchema);
