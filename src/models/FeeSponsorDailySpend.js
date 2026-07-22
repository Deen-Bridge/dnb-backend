import mongoose from "mongoose";

const feeSponsorDailySpendSchema = new mongoose.Schema(
  {
    dateKey: { type: String, required: true, unique: true, index: true },
    totalStroops: { type: Number, default: 0, min: 0 },
    perUser: { type: Map, of: Number, default: {} },
  },
  { timestamps: true }
);

export default mongoose.model("FeeSponsorDailySpend", feeSponsorDailySpendSchema);
