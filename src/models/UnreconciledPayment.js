import mongoose from "mongoose";

/**
 * Machine-readable reasons a USDC payment could not be attributed. Each one
 * maps to a triage action in docs/payment-reconciliation.md.
 */
export const UNRECONCILED_REASON_CODES = Object.freeze({
  NO_REFERENCE: "no_reference",
  MALFORMED_REFERENCE: "malformed_reference",
  REFERENCE_NOT_FOUND: "reference_not_found",
  AMBIGUOUS_REFERENCE: "ambiguous_reference",
  ITEM_TYPE_MISMATCH: "item_type_mismatch",
  ITEM_NOT_FOUND: "item_not_found",
  REFERENCE_ALREADY_SETTLED: "reference_already_settled",
  REFERENCE_HASH_MISMATCH: "reference_hash_mismatch",
  TRANSACTION_NOT_RECONCILABLE: "transaction_not_reconcilable",
  NETWORK_MISMATCH: "network_mismatch",
  ASSET_MISMATCH: "asset_mismatch",
  SOURCE_MISMATCH: "source_mismatch",
  DESTINATION_MISMATCH: "destination_mismatch",
  AMOUNT_MISMATCH: "amount_mismatch",
  VERIFICATION_FAILED: "verification_failed",
  VERIFICATION_UNAVAILABLE: "verification_unavailable",
  UNKNOWN_DONOR: "unknown_donor",
  LOOKUP_FAILED: "lookup_failed",
});

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
  reasonCode: {
    type: String,
    enum: Object.values(UNRECONCILED_REASON_CODES),
  },
  // How the memo was classified ("canonical", "legacy", "donation", ...) and,
  // when one was resolved, the checkout it pointed at. Lets an operator jump
  // straight to the candidate row instead of re-parsing the memo.
  referenceKind: {
    type: String,
  },
  transaction: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Transaction",
  },
  // Duplicate Horizon events and worker retries bump these instead of
  // creating new rows. No schema default: the upsert's `$inc` seeds it.
  attempts: {
    type: Number,
  },
  lastSeenAt: {
    type: Date,
  },
  resolvedAt: {
    type: Date,
  },
}, { timestamps: true });

unreconciledPaymentSchema.index({ resolvedAt: 1, reasonCode: 1, createdAt: -1 });
// Reconciliation health (#696): open-backlog age buckets and the oldest-first
// sample walk { resolvedAt: null, createdAt }, and the arrival rate is a
// createdAt range. Both stay index-bounded as the collection grows.
unreconciledPaymentSchema.index({ resolvedAt: 1, createdAt: 1 });
unreconciledPaymentSchema.index({ createdAt: 1 });

export default mongoose.model("UnreconciledPayment", unreconciledPaymentSchema);
