import mongoose from "mongoose";

const submissionSchema = new mongoose.Schema(
  {
    summary: { type: String, required: true, maxlength: 2000 },
    evidenceUrl: { type: String, maxlength: 2000 },
    submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    submittedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["submitted", "approved", "rejected", "released"], default: "submitted" },
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewNote: { type: String, maxlength: 1200 },
    releaseTxHash: String,
  },
  { _id: false }
);

const scholarshipMilestoneReportSchema = new mongoose.Schema(
  {
    contractId: { type: String, required: true },
    milestoneIndex: { type: Number, required: true, min: 0, max: 99 },
    beneficiaryWallet: { type: String, required: true },
    current: { type: submissionSchema, required: true },
    history: { type: [submissionSchema], default: [] },
  },
  { timestamps: true }
);

scholarshipMilestoneReportSchema.index({ contractId: 1, milestoneIndex: 1 }, { unique: true });

export default mongoose.model("ScholarshipMilestoneReport", scholarshipMilestoneReportSchema);
