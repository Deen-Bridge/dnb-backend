import mongoose from "mongoose";

const reviewSchema = new mongoose.Schema(
  {
    reviewer: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    scores: {
      need: { type: Number, min: 1, max: 5, required: true },
      studyPlan: { type: Number, min: 1, max: 5, required: true },
      impact: { type: Number, min: 1, max: 5, required: true },
      eligibility: { type: Number, min: 1, max: 5, required: true },
    },
    recommendation: { type: String, enum: ["support", "do_not_support"], required: true },
    note: { type: String, maxlength: 1200, required: true },
    reviewedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const scholarshipApplicationSchema = new mongoose.Schema(
  {
    cycleId: { type: String, required: true, default: () => process.env.SCHOLARSHIP_CYCLE_ID || "current" },
    applicant: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    requestedAmountUsdc: { type: String, required: true },
    studyGoal: { type: String, required: true, maxlength: 1600 },
    needStatement: { type: String, required: true, maxlength: 1600 },
    eligibilityConfirmed: { type: Boolean, required: true },
    eligibilityRulesSnapshot: { type: String, required: true, maxlength: 5000 },
    fundingPolicySnapshot: { type: String, required: true, maxlength: 5000 },
    status: {
      type: String,
      enum: ["submitted", "selected", "not_selected"],
      default: "submitted",
      index: true,
    },
    reviews: { type: [reviewSchema], default: [] },
    decision: {
      decidedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      decidedAt: Date,
      reason: { type: String, maxlength: 1200 },
    },
  },
  { timestamps: true }
);

scholarshipApplicationSchema.index(
  { cycleId: 1, applicant: 1 },
  { unique: true, name: "unique_scholarship_applicant_per_cycle" }
);
scholarshipApplicationSchema.index(
  { cycleId: 1 },
  { unique: true, partialFilterExpression: { status: "selected" }, name: "one_selected_scholarship_per_cycle" }
);
scholarshipApplicationSchema.index({ cycleId: 1, status: 1, createdAt: 1 });

export default mongoose.model("ScholarshipApplication", scholarshipApplicationSchema);
