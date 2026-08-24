// models/OnrampTransaction.js
import mongoose from "mongoose";

/**
 * Internal on-ramp lifecycle statuses.
 *
 * These are provider-agnostic. Raw provider statuses (e.g. MoonPay's
 * `waitingPayment`, `pending`, `completed`, `failed`) are normalized into this
 * set by {@link module:services/stellar/onrampService.mapProviderStatus} and the
 * original provider value is preserved in `providerStatus` for audit.
 *
 * @constant {string[]}
 */
export const ONRAMP_STATUSES = [
  "created",
  "pending",
  "completed",
  "failed",
];

/**
 * Tracks a fiat-to-crypto on-ramp purchase initiated through a third-party
 * provider (MoonPay). Each record links a widget session to the user account
 * that started it and is updated as provider webhooks report status changes.
 *
 * A dedicated collection is used (rather than the shared `Transaction` model)
 * because on-ramp purchases are settled entirely by the provider and do not
 * carry the buyer/creator/item shape of on-chain marketplace transactions.
 */
const onrampTransactionSchema = new mongoose.Schema(
  {
    // User account that initiated the on-ramp purchase.
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Stellar public key the purchased asset is delivered to (pre-filled in
    // the widget URL).
    walletAddress: {
      type: String,
      required: true,
      index: true,
    },
    // On-ramp provider used for this session.
    provider: {
      type: String,
      enum: ["moonpay"],
      default: "moonpay",
      index: true,
    },
    // Provider-side transaction identifier, populated from webhook payloads.
    // Sparse because it is unknown until the first webhook arrives.
    providerTransactionId: {
      type: String,
      sparse: true,
      index: true,
    },
    // Normalized lifecycle status (see ONRAMP_STATUSES).
    status: {
      type: String,
      enum: ONRAMP_STATUSES,
      default: "created",
      index: true,
    },
    // Raw provider status string, kept verbatim for audit/debugging.
    providerStatus: {
      type: String,
    },
    // Crypto asset the user is buying (e.g. "usdc", "xlm").
    cryptoCurrency: {
      type: String,
    },
    // Fiat currency used to pay (e.g. "usd", "eur").
    fiatCurrency: {
      type: String,
    },
    // Fiat amount charged. Stored as a string to preserve precision.
    fiatAmount: {
      type: String,
    },
    // Crypto amount delivered, once known. Stored as a string for precision.
    cryptoAmount: {
      type: String,
    },
    // On-chain settlement hash reported by the provider when the crypto is sent.
    cryptoTransactionHash: {
      type: String,
    },
    // Reason recorded when the provider reports a failed purchase.
    failureReason: {
      type: String,
    },
    completedAt: Date,
  },
  { timestamps: true }
);

// Common lookup: a user's on-ramp history, most recent first.
onrampTransactionSchema.index({ user: 1, createdAt: -1 });

export default mongoose.model("OnrampTransaction", onrampTransactionSchema);
