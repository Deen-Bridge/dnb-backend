// models/Transaction.js
import mongoose from "mongoose";

const transactionSchema = new mongoose.Schema(
  {
    // Transaction identification
    stellarTxHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    stellarLedger: {
      type: Number,
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
      required: true,
      index: true,
    },
    creatorWallet: {
      type: String,
      required: true,
    },

    // Item being purchased
    itemType: {
      type: String,
      enum: ["book", "course"],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "itemTypeModel",
    },
    itemTypeModel: {
      type: String,
      enum: ["Book", "Course"],
      required: true,
    },
    itemTitle: {
      type: String,
      required: true,
    },

    // Payment details
    amount: {
      type: String, // Store as string to preserve precision
      required: true,
    },
    currency: {
      type: String,
      default: "USDC",
      enum: ["USDC"],
    },
    network: {
      type: String,
      enum: ["testnet", "mainnet"],
      required: true,
    },

    // Status tracking
    status: {
      type: String,
      enum: ["pending", "submitted", "confirmed", "failed", "expired"],
      default: "pending",
      index: true,
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
      default: () => new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
transactionSchema.index({ buyer: 1, status: 1 });
transactionSchema.index({ creator: 1, status: 1 });
transactionSchema.index({ itemType: 1, itemId: 1 });
transactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL for expired pending

export default mongoose.model("Transaction", transactionSchema);
