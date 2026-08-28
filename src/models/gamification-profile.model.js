import mongoose from "mongoose";

const profileSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true },
  xp: { type: Number, default: 0, min: 0 },
  level: { type: Number, default: 1, min: 1 },
  lastEvaluatedAt: { type: Date, default: null },
}, { timestamps: true });

export default mongoose.model("GamificationProfile", profileSchema);
