// models/AnchorTransaction.js
import mongoose from "mongoose";

const anchorTransactionSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    homeDomain: {
      type: String,
      required: true,
    },
    kind: {
      type: String,
      enum: ["deposit", "withdrawal"],
      required: true,
    },
    // The anchor's own transaction id (SEP-24 `id`). Scoped to the anchor,
    // not globally unique across anchors, hence the compound unique index.
    anchorTransactionId: {
      type: String,
      required: true,
    },
    assetCode: {
      type: String,
      default: "USDC",
    },
    // SEP-24 statuses are stored verbatim, not normalized - the frontend
    // needs the full anchor-reported vocabulary (incomplete, pending_user_transfer_start,
    // pending_anchor, pending_stellar, completed, error, etc.), not a collapsed subset.
    status: {
      type: String,
      required: true,
      default: "incomplete",
      index: true,
    },
    interactiveUrl: {
      type: String,
    },
    // Amounts/fees stored as strings to preserve precision, matching Transaction.js.
    amountIn: { type: String },
    amountOut: { type: String },
    amountFee: { type: String },
    stellarTxHash: {
      type: String,
    },
    // Poller bookkeeping
    lastPolledAt: { type: Date },
    nextPollAt: { type: Date, default: Date.now, index: true },
    pollAttempts: { type: Number, default: 0 },
    lastError: { type: String },
  },
  { timestamps: true }
);

anchorTransactionSchema.index({ user: 1, status: 1 });
anchorTransactionSchema.index(
  { homeDomain: 1, anchorTransactionId: 1 },
  { unique: true }
);
anchorTransactionSchema.index({ status: 1, nextPollAt: 1 });

export default mongoose.model("AnchorTransaction", anchorTransactionSchema);
