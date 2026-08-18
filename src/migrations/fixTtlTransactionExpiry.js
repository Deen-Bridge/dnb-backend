import dotenv from "dotenv";
import mongoose from "mongoose";
import Transaction from "../models/Transaction.js";
import logger from "../config/logger.js";

dotenv.config();

/**
 * Migration: fixTtlTransactionExpiry
 *
 * The `Transaction` collection previously had a blanket TTL index on
 * `expiresAt` ({ expireAfterSeconds: 0 }) and a schema default that stamped a
 * 30-minute expiry on every row regardless of status. Because confirm paths
 * never cleared `expiresAt`, confirmed purchases/donations were reaped ~30
 * minutes after creation — deleting the proof of payment and leaving orphaned
 * earnings behind.
 *
 * This migration:
 *   1. `$unset`s `expiresAt` on every existing non-`pending` transaction so
 *      the TTL reaper can never touch already-confirmed (or otherwise
 *      terminal) rows before the index swap completes.
 *   2. Drops the blanket `{ expiresAt: 1 }` TTL index (if present) and
 *      recreates it as a partial index scoped strictly to
 *      `{ status: "pending" }`, so reaping is structurally impossible for
 *      non-pending rows even if a future code path forgets step 1.
 *
 * Idempotent: running it again is a no-op for data (no non-pending rows carry
 * `expiresAt`) and for the index (the partial index already matches).
 */
export const fixTtlTransactionExpiry = async () => {
  const collection = Transaction.collection;

  // 1. Rescue legacy terminal rows from the TTL reaper before touching indexes.
  const updateResult = await Transaction.updateMany(
    {
      status: { $ne: "pending" },
      expiresAt: { $exists: true, $ne: null },
    },
    { $unset: { expiresAt: 1 } }
  );

  const modifiedCount = updateResult.modifiedCount ?? updateResult.nModified ?? 0;
  logger.info(`Unset expiresAt on ${modifiedCount} non-pending transaction(s).`);

  // 2. Replace the blanket TTL index with the partial-filter version. A schema
  //    `.index()` edit does NOT alter an already-built index, so this must be
  //    done explicitly.
  const indexes = await collection.indexes();
  const ttlIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);

  const hasPendingPartialFilter =
    ttlIndex?.partialFilterExpression?.status === "pending";

  if (ttlIndex && !hasPendingPartialFilter) {
    logger.info(`Dropping blanket TTL index "${ttlIndex.name}"...`);
    await collection.dropIndex(ttlIndex.name);
  }

  // If the correct partial index already exists this is a no-op.
  await collection.createIndex(
    { expiresAt: 1 },
    { expireAfterSeconds: 0, partialFilterExpression: { status: "pending" } }
  );
  logger.info("Ensured partial TTL index scoped to status: pending.");

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
