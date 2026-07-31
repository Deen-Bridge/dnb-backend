// models/Refund.js
import mongoose from "mongoose";

const refundSchema = new mongoose.Schema(
  {
    originalTransaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
      required: true,
    },
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    educator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["book", "course"],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    currency: {
      type: String,
      default: "USDC",
    },
    reason: {
      type: String,
      required: [true, "Refund reason is required"],
      trim: true,
    },
    status: {
      type: String,
      enum: [
        "requested",
        "approved",
        "submitted",
        "confirmed",
        "rejected",
        "failed",
        "disputed",
        "resolved",
      ],
      default: "requested",
      index: true,
    },
    refundTxHash: {
      type: String,
      default: null,
      index: true,
    },
    refundLedger: {
      type: Number,
      default: null,
    },
    rejectionReason: {
      type: String,
      default: null,
    },
    resolution: {
      decision: {
        type: String,
        enum: ["approved", "rejected", "off_chain_resolved"],
      },
      notes: String,
      resolvedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      resolvedAt: Date,
    },
    expiresAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

// Ensure one active refund request per original transaction
refundSchema.index(
  { originalTransaction: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["requested", "approved", "submitted", "disputed"] },
    },
  }
);

export default mongoose.model("Refund", refundSchema);
