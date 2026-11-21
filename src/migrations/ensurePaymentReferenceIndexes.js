import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import UnreconciledPayment from "../models/UnreconciledPayment.js";
import logger from "../config/logger.js";

dotenv.config();

/**
 * Migration: ensurePaymentReferenceIndexes (issue #695)
 *
 * Reconciliation now resolves purchase memos through a canonical
 * `Transaction.paymentReference` instead of the last eight characters of an
 * item id. This migration:
 *
 *   1. Builds the unique partial index on `paymentReference` and the compound
 *      `{ memo, itemType, status, buyerWallet }` index used for legacy memos.
 *      Mongoose `autoIndex` normally does this, but production deployments
 *      that disable it must run this before the new worker is rolled out —
 *      without the unique index, reconciliation fails closed as ambiguous.
 *   2. Builds the triage index on `UnreconciledPayment`.
 *   3. Reports how many open checkouts still carry a legacy suffix memo. No
 *      data is rewritten: those memos are already inside signed transactions,
 *      so they keep resolving by exact memo + payer until they settle or
 *      expire. Once the count reaches zero the legacy path is idle.
 *
 * Idempotent: createIndex with an identical spec is a no-op, and the report
 * is read-only.
 */
export const ensurePaymentReferenceIndexes = async () => {
  const transactions = Transaction.collection;

  await transactions.createIndex(
    { paymentReference: 1 },
    { unique: true, partialFilterExpression: { paymentReference: { $type: "string" } } }
  );
  await transactions.createIndex({ memo: 1, itemType: 1, status: 1, buyerWallet: 1 });
  await UnreconciledPayment.collection.createIndex({ resolvedAt: 1, reasonCode: 1, createdAt: -1 });
  logger.info("Ensured payment reference and reconciliation indexes.");

  const openLegacyCheckouts = await Transaction.countDocuments({
    status: { $in: ["pending", "submitted", "retrying"] },
    paymentReference: { $exists: false },
    memo: { $regex: /^DNB-(BOOK|COURSE)-/ },
  });
  logger.info(`${openLegacyCheckouts} open checkout(s) still use legacy suffix memos.`);

  return { openLegacyCheckouts };
};

// Standalone CLI execution
if (process.argv[1] && process.argv[1].endsWith("ensurePaymentReferenceIndexes.js")) {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be set to run the payment reference index migration");
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const result = await ensurePaymentReferenceIndexes();
    console.log(`Migration complete: ${result.openLegacyCheckouts} open legacy checkout(s) remaining.`);
  } finally {
    await mongoose.disconnect();
  }
}
