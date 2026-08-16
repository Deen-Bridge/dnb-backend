import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import logger from "../config/logger.js";

dotenv.config();

/**
 * Migration: fixTtlTransactionExpiry
 *
 * 1. Unsets `expiresAt` on all non-pending transactions (e.g. confirmed, failed,
 *    refunded, expired, disputed) to prevent TTL background thread from reaping them.
 * 2. Replaces the blanket TTL index on `expiresAt` with a partial index scoped
 *    strictly to `{ status: "pending" }`.
 */
export const fixTtlTransactionExpiry = async () => {
  const collection = Transaction.collection;

  // 1. Unset expiresAt on all non-pending transactions
  const updateResult = await Transaction.updateMany(
    {
      status: { $ne: "pending" },
      expiresAt: { $exists: true, $ne: null },
    },
    {
      $unset: { expiresAt: 1 },
    }
  );

  const modifiedCount = updateResult.modifiedCount ?? updateResult.nModified ?? 0;
  logger.info(`Unset expiresAt on ${modifiedCount} non-pending transaction(s).`);

  // 2. Refresh TTL index to partial index
  try {
    const indexes = await collection.indexes();
    const existingTtlIndex = indexes.find(
      (idx) => idx.key && idx.key.expiresAt === 1
    );

    if (existingTtlIndex) {
      // If the index already exists but does not have the partial filter, drop it
      const hasCorrectPartial =
        existingTtlIndex.partialFilterExpression &&
        existingTtlIndex.partialFilterExpression.status === "pending";

      if (!hasCorrectPartial) {
        logger.info(`Dropping existing TTL index "${existingTtlIndex.name}"...`);
        await collection.dropIndex(existingTtlIndex.name);
      }
    }

    // Ensure the new partial index exists
    await collection.createIndex(
      { expiresAt: 1 },
      {
        expireAfterSeconds: 0,
        partialFilterExpression: { status: "pending" },
        background: true,
      }
    );
    logger.info("Created partial TTL index for pending transactions.");
  } catch (indexError) {
    logger.error("Error managing indexes during TTL migration:", indexError);
    throw indexError;
  }

  return { modifiedCount };
};

// Standalone CLI execution
if (process.argv[1] && process.argv[1].endsWith("fixTtlTransactionExpiry.js")) {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI must be set to run TTL transaction expiry migration");
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    const result = await fixTtlTransactionExpiry();
    console.log(`Migration complete: ${result.modifiedCount} documents updated.`);
  } finally {
    await mongoose.disconnect();
  }
}
