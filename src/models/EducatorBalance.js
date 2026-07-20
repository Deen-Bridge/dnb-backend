// models/EducatorBalance.js
import mongoose from "mongoose";

const educatorBalanceSchema = new mongoose.Schema(
  {
    educator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    owedStroops: {
      type: String,
      default: "0",
    },
    settledStroops: {
      type: String,
      default: "0",
    },
    lastPayoutAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

export default mongoose.model("EducatorBalance", educatorBalanceSchema);
