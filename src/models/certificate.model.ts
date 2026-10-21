import mongoose from "mongoose";

const certificateSchema = new mongoose.Schema(
  {
    certificateId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    course: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Course",
      required: true,
      index: true,
    },
    learnerName: {
      type: String,
      required: true,
    },
    courseTitle: {
      type: String,
      required: true,
    },
    completionDate: {
      type: Date,
      default: Date.now,
    },
    instructorName: {
      type: String,
      default: "DeenBridge Instructor",
    },
    instructorSignature: {
      type: String,
      default: "DeenBridge Academy",
    },
    certificateUrl: {
      type: String,
      required: true,
    },
    certificateHash: {
      type: String,
      index: true,
    },
    stellarTx: {
      type: String,
      default: null,
    },
    verificationUrl: {
      type: String,
    },
  },
  { timestamps: true }
);

certificateSchema.index({ user: 1, course: 1 }, { unique: true });

export default mongoose.model("Certificate", certificateSchema);
