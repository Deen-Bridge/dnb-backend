// models/Transaction.js
import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";
import { notifyPaymentStatus } from "../sockets/paymentNotifier.js";

const transactionSchema = new mongoose.Schema(
  {
    // Transaction identification
    stellarTxHash: {
      type: String,
      sparse: true,
      unique: true,
      index: true,
    },
    expectedHash: {
      type: String,
      index: true,
    },
    // The unsigned XDR returned at initialize, persisted so a duplicate
    // initialize for the same pending checkout can replay the exact same
    // transaction to sign (idempotent initialize). Never used for
    // verification — only for replay of the pending record.
    unsignedXdr: {
      type: String,
    },
    memo: {
      type: String,
    },
    stellarLedger: {
      type: Number,
    },
    // Transaction kind: item purchase or sadaqah donation
    type: {
      type: String,
      enum: ["purchase", "donation"],
      default: "purchase",
      index: true,
    },
    // Parties involved
    buyer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    buyerWallet: {
      type: String,
      required: true,
    },
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: function () {
        return this.type !== "donation";
      },
      index: true,
    },
    creatorWallet: {
      type: String,
      required: true,
    },
    // Item being purchased (not applicable to donations)
    itemType: {
      type: String,
      enum: ["book", "course"],
      required: function () {
        return this.type !== "donation";
      },
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: function () {
        return this.type !== "donation";
      },
      refPath: "itemTypeModel",
    },
    itemTypeModel: {
      type: String,
      enum: ["Book", "Course"],
      required: function () {
        return this.type !== "donation";
      },
    },
    itemTitle: {
      type: String,
      required: function () {
        return this.type !== "donation";
      },
    },
    // Payment details
    amount: {
      type: String, // Store as string to preserve precision
      required: true,
    },
    // Widened from a USDC-only enum to the full asset registry; existing
    // rows with no currency set default to "USDC" so nothing breaks.
    currency: {
      type: String,
      default: "USDC",
      enum: getSupportedCodes(),
    },
    // Issuer for the settled currency (null for native XLM). Separate from
    // sendAsset below, which is the asset the *buyer* sent in a path payment.
    assetIssuer: {
      type: String,
      default: null,
    },
    sendAsset: {
      code: { type: String },
      issuer: { type: String },
    },
    sendMax: { type: String },
    network: {
      type: String,
      enum: ["testnet", "mainnet"],
      required: true,
    },
    // Platform fee split (only set when a fee was applied at build time)
    platformFee: {
      feePercent: Number,
      platformWallet: String,
      platformAmount: String, // Stored as string to preserve precision
      creatorAmount: String,
    },
    // Settlement mode: direct payment to creator or platform collect for payouts
    settlement: {
      type: String,
      enum: ["direct", "platform_collect"],
      default: "direct",
      index: true,
    },
    // Fee-bump sponsorship (#30): set only when the platform paid this
    // transaction's network fee via a fee-bump wrapper. Absent/false means the
    // user paid their own fee (the default, unchanged flow).
    sponsored: {
      type: Boolean,
      default: false,
    },
    // Actual XLM fee (in stroops) the sponsor account paid, taken from the
    // Horizon submit response `fee_charged`. Stored as a string to stay
    // consistent with the precision-preserving `amount` field.
    sponsorFeeCharged: {
      type: String,
    },
    // Horizon returns the fee-bump (outer) transaction hash; `stellarTxHash`
    // continues to hold the inner-transaction hash (which matches
    // `expectedHash` from initialize), so both are recorded for a sponsored row.
    feeBumpTxHash: {
      type: String,
    },
    // Status tracking
    status: {
      type: String,
      enum: ["pending", "submitted", "retrying", "confirmed", "failed", "expired", "refunded", "disputed"],
      default: "pending",
      index: true,
    },
    // Refund linkage
    refund: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Refund",
      default: null,
    },
    // Error handling
    failureReason: {
      type: String,
    },
    retryCount: {
      type: Number,
      default: 0,
    },
    // Timestamps
    submittedAt: Date,
    confirmedAt: Date,
    expiresAt: {
      type: Date,
      // Only abandoned `pending` checkouts get a reaping deadline. Records
      // created directly in a terminal state (e.g. worker-created confirmed
      // donations/purchases) must never be born with an expiry.
      default: function () {
        return this.status === "pending" || !this.status
          ? new Date(Date.now() + 30 * 60 * 1000) // 30 minutes
          : undefined;
      },
    },
  },
  { timestamps: true }
);

// Terminal statuses are permanent records (paid purchases, donations, refunds,
// disputes, failures) that must never be reaped by the TTL monitor.
const TERMINAL_STATUSES = ["confirmed", "failed", "expired", "refunded", "disputed"];

// TTL invariant: `expiresAt` is only meaningful for abandoned `pending`
// checkouts. Enforce it at the schema level so a future code path that forgets
// to clear `expiresAt` cannot regress confirmed/terminal rows back into the
// TTL reaper's window — defense in depth on top of the partial index below.
transactionSchema.pre("save", function (next) {
  if (TERMINAL_STATUSES.includes(this.status)) {
    this.expiresAt = undefined;
  }

  // Remember whether this save is worth a realtime push (creation or any
  // status transition). Read back by the post-save hook below; mongoose
  // clears its modified-path tracking after save completes, so the flag is
  // captured here while it is still reliable.
  this.$locals.__statusChanged = this.isNew || this.isModified("status");
  next();
});

// Realtime payment notifications: push status transitions to subscribed
// websocket clients (see src/sockets/). Best-effort — a gateway outage must
// never fail a save. Covers every code path that persists through `save()`
// (donation controller, reconciliation service, ingestion worker).
transactionSchema.post("save", function (doc, next) {
  if (doc.$locals?.__statusChanged) {
    Promise.resolve(notifyPaymentStatus(doc)).catch(() => {});
  }
  next();
});

// Indexes for efficient queries
transactionSchema.index({ buyer: 1, status: 1 });
transactionSchema.index({ creator: 1, status: 1 });
transactionSchema.index({ itemType: 1, itemId: 1 });
transactionSchema.index({ type: 1, status: 1, createdAt: -1 }); // Donation stats
// TTL for expired pending checkouts only — a blanket index would also reap
// confirmed purchases/donations once their original 30-minute expiry passes.
transactionSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 0, partialFilterExpression: { status: "pending" } }
);
export default mongoose.model("Transaction", transactionSchema);