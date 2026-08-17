import mongoose from "mongoose";

export const VERIFICATION_STATUS = Object.freeze({
  DRAFT: "draft",
  PENDING: "pending",
  APPROVED: "approved",
  REJECTED: "rejected",
});

export const LEGAL_TRANSITIONS = Object.freeze({
  [VERIFICATION_STATUS.DRAFT]: [VERIFICATION_STATUS.PENDING],
  [VERIFICATION_STATUS.PENDING]: [
    VERIFICATION_STATUS.APPROVED,
    VERIFICATION_STATUS.REJECTED,
  ],
  [VERIFICATION_STATUS.APPROVED]: [],
  [VERIFICATION_STATUS.REJECTED]: [VERIFICATION_STATUS.PENDING],
});

const STATUS_VALUES = Object.values(VERIFICATION_STATUS);

const documentSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      required: [true, "Document type is required"],
      enum: [
        "government_id",
        "teaching_certificate",
        "degree",
        "work_sample",
        "other",
      ],
    },
    cloudinaryPublicId: {
      type: String,
      required: [true, "Document cloudinaryPublicId is required"],
    },
    originalFileName: {
      type: String,
      required: [true, "Document originalFileName is required"],
    },
    uploadedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false, versionKey: false }
);

const educatorVerificationSchema = new mongoose.Schema(
  {
    applicant: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: [true, "Applicant is required"],
      index: true,
    },

    status: {
      type: String,
      enum: STATUS_VALUES,
      default: VERIFICATION_STATUS.DRAFT,
      required: [true, "Status is required"],
      index: true,
    },

    documents: {
      type: [documentSchema],
      default: [],
    },

    personalStatement: {
      type: String,
      maxlength: 2000,
      default: null,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewNotes: {
      type: String,
      maxlength: 2000,
      default: null,
    },

    submittedAt: {
      type: Date,
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, versionKey: false }
);

educatorVerificationSchema.index(
  { applicant: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: { $in: ["draft", "pending"] } } }
);

educatorVerificationSchema.statics.isValidTransition = function (from, to) {
  const allowed = LEGAL_TRANSITIONS[from];
  return Array.isArray(allowed) && allowed.includes(to);
};

educatorVerificationSchema.methods.canTransitionTo = function (targetStatus) {
  return this.constructor.isValidTransition(this.status, targetStatus);
};

educatorVerificationSchema.pre("save", function (next) {
  if (!this.isModified("status")) return next();
  if (this.isNew) return next();

  const prev = this.modifiedPaths().includes("status")
    ? this.$locals.previousStatus
    : null;
  next();
});

educatorVerificationSchema.pre("findOneAndUpdate", function (next) {
  const update = this.getUpdate();
  const nextStatus = update?.$set?.status ?? update?.status;
  if (!nextStatus) return next();
  next();
});

export default mongoose.model(
  "EducatorVerification",
  educatorVerificationSchema
);
