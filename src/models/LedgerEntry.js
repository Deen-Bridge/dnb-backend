// models/LedgerEntry.js
import mongoose from "mongoose";

const ledgerEntrySchema = new mongoose.Schema(
  {
    educator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["sale", "payout"],
      required: true,
    },
    txRef: {
      type: String,
      required: true,
      index: true,
    },
    amount: {
      type: String, // String representation of USDC decimal amount
      required: true,
    },
    amountStroops: {
      type: String, // String representation of stroops (BigInt)
      required: true,
    },
    settlement: {
      type: String,
      enum: ["direct", "platform_collect"],
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

ledgerEntrySchema.index({ educator: 1, createdAt: -1 });

export default mongoose.model("LedgerEntry", ledgerEntrySchema);
