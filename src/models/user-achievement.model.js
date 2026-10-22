import mongoose from "mongoose";
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  achievement: { type: mongoose.Schema.Types.ObjectId, ref: "Achievement", required: true },
  xpAwarded: { type: Number, required: true, min: 0 },
  awardedAt: { type: Date, default: Date.now },
}, { timestamps: true });
schema.index({ user: 1, achievement: 1 }, { unique: true });
export default mongoose.model("UserAchievement", schema);
