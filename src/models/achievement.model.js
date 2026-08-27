import mongoose from "mongoose";
const schema = new mongoose.Schema({
  slug: { type: String, required: true, unique: true }, name: { type: String, required: true },
  description: { type: String, required: true }, category: String,
  tier: { type: String, enum: ["bronze", "silver", "gold"], required: true },
  criteriaType: { type: String, enum: ["donations", "courses_completed"], required: true },
  threshold: { type: Number, required: true, min: 1 }, xp: { type: Number, required: true, min: 0 },
}, { timestamps: true });
export default mongoose.model("Achievement", schema);
