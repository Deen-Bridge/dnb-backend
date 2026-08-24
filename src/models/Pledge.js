import mongoose from "mongoose";

const pledgeSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    publicKey: { type: String, required: true },
    amount: { type: String, required: true },
    cadence: { type: String, enum: ["daily", "weekly", "monthly"], required: true },
    anchorDay: { type: Number, min: 0, max: 6 },
    anchorDate: { type: Number, min: 1, max: 31 },
    status: { type: String, enum: ["active", "paused", "cancelled"], default: "active", index: true },
    nextDueAt: { type: Date, required: true, index: true },
    consecutivePaid: { type: Number, default: 0 },
    longestStreak: { type: Number, default: 0 },
    totalPaidStroops: { type: String, default: "0" },
    lastPaidAt: Date,
    schedulerLockUntil: Date,
  },
  { timestamps: true }
);

pledgeSchema.index({ status: 1, nextDueAt: 1 });
export default mongoose.model("Pledge", pledgeSchema);
