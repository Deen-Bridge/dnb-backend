import mongoose from "mongoose";

const unreconciledPaymentSchema = new mongoose.Schema({
  stellarTxHash: {
    type: String,
    required: true,
    unique: true,
  },
  from: {
    type: String,
    required: true,
  },
  to: {
    type: String,
    required: true,
  },
  amount: {
    type: String,
    required: true,
  },
  memo: {
    type: String,
  },
  sourceAccount: {
    type: String,
  },
  reason: {
    type: String,
    required: true,
  },
}, { timestamps: true });

export default mongoose.model("UnreconciledPayment", unreconciledPaymentSchema);
