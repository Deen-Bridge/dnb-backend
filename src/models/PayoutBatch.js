// models/PayoutBatch.js
import mongoose from "mongoose";

const recipientSchema = new mongoose.Schema(
  {
    educator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    wallet: {
      type: String,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    stroops: {
      type: String,
      required: true,
    },
  },
  { _id: false }
);

const chunkSchema = new mongoose.Schema(
  {
    chunkIndex: {
      type: Number,
      required: true,
    },
    xdr: {
      type: String,
      required: true,
    },
    hash: {
      type: String,
    },
  },
  { _id: false }
);

const payoutBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    recipients: [recipientSchema],
    totalAmount: {
      type: String,
      required: true,
    },
    totalStroops: {
      type: String,
      required: true,
    },
    chunks: [chunkSchema],
    status: {
      type: String,
      enum: ["built", "submitted", "confirmed", "failed"],
      default: "built",
      index: true,
    },
    failureReason: {
      type: String,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  },
  { timestamps: true }
);

export default mongoose.model("PayoutBatch", payoutBatchSchema);
