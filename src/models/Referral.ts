import mongoose from "mongoose";

const referralSchema = new mongoose.Schema(
  {
    referrer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    referee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    referralCode: {
      type: String,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["pending", "completed", "rewarded"],
      default: "pending",
      required: true,
    },
    rewardAmount: {
      type: Number,
      default: 0,
    },
    rewardCurrency: {
      type: String,
      default: "USDC",
    },
    completedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Referral", referralSchema);
