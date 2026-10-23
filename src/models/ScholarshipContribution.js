import mongoose from "mongoose";

const scholarshipContributionSchema = new mongoose.Schema(
  {
    donor: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    donorWallet: { type: String, required: true },
    contractId: { type: String, required: true, index: true },
    network: { type: String, enum: ["testnet", "mainnet"], required: true },
    kind: { type: String, enum: ["fund", "refund", "release"], default: "fund", required: true },
    amountStroops: { type: String, default: "0" },
    milestoneIndex: Number,
    milestoneReport: { type: mongoose.Schema.Types.ObjectId, ref: "ScholarshipMilestoneReport" },
    expectedHash: { type: String, required: true, unique: true },
    stellarTxHash: { type: String, sparse: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "submitted", "confirmed", "failed"],
      default: "pending",
      index: true,
    },
    expiresAt: { type: Date, index: { expires: 0 } },
    confirmedAt: Date,
    failureReason: String,
  },
  { timestamps: true }
);

scholarshipContributionSchema.index({ donor: 1, createdAt: -1 });
scholarshipContributionSchema.index({ contractId: 1, status: 1, createdAt: -1 });

export default mongoose.model("ScholarshipContribution", scholarshipContributionSchema);
