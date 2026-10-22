import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Transaction from "../src/models/Transaction.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import { fixTtlTransactionExpiry } from "../src/migrations/fixTtlTransactionExpiry.js";

const TERMINAL_STATUSES = ["confirmed", "failed", "expired", "refunded", "disputed"];

const makeKey = (prefix) => {
  const p = prefix.padEnd(55, "0").slice(0, 55).toUpperCase();
  return "G" + p;
};

// Regression tests for https://github.com/Deen-Bridge/dnb-backend/issues/6
// Confirmed/failed purchase records must never be deleted by the TTL index.
describe("Transaction TTL expiry & lifecycle invariant (closes #6)", () => {
  let mongoServer;
  let buyer;
  let author;
  let book;

  beforeAll(async () => {
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Transaction.deleteMany({}),
      User.deleteMany({}),
      Book.deleteMany({}),
    ]);

    buyer = await User.create({
      name: "Buyer User",
      email: "buyer_ttl@example.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("BUYER") },
    });

    author = await User.create({
      name: "Author User",
      email: "author_ttl@example.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("AUTHOR") },
    });

    book = await Book.create({
      title: "TTL Test Book",
      description: "Testing TTL invariants",
      category: "Tech",
      price: 15,
      author: author._id,
      thumbnail: "https://example.com/thumb.jpg",
      image: "https://example.com/image.jpg",
      fileUrl: "https://example.com/file.pdf",
    });
  });

  const baseFields = () => ({
    buyer: buyer._id,
    buyerWallet: buyer.stellarWallet.publicKey,
    creator: author._id,
    creatorWallet: author.stellarWallet.publicKey,
    itemType: "book",
    itemId: book._id,
    itemTypeModel: "Book",
    itemTitle: book.title,
    amount: "15",
    network: "testnet",
  });

  describe("schema default", () => {
    it("assigns a 30-minute expiresAt by default for pending transactions", async () => {
      const tx = await Transaction.create({
        ...baseFields(),
        status: "pending",
        stellarTxHash: "pending-default-hash",
      });

      expect(tx.expiresAt).toBeInstanceOf(Date);
      expect(tx.expiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(tx.expiresAt.getTime()).toBeLessThanOrEqual(
        Date.now() + 31 * 60 * 1000
      );
    });

    it("does NOT assign expiresAt when created directly in a terminal state", async () => {
      for (const status of TERMINAL_STATUSES) {
        const tx = await Transaction.create({
          ...baseFields(),
          status,
          stellarTxHash: `terminal-${status}-hash`,
        });
        expect(tx.expiresAt).toBeUndefined();
      }
    });

    it("keeps expiresAt for transient submitted/retrying states", async () => {
      const pending = await Transaction.create({
        ...baseFields(),
        status: "pending",
        stellarTxHash: "transient-hash",
      });

      for (const status of ["submitted", "retrying"]) {
        pending.status = status;
        await pending.save();
        expect(pending.expiresAt).toBeInstanceOf(Date);
      }
    });
  });

  describe("pre-save hook (defense in depth)", () => {
    it("clears expiresAt when a document transitions to a terminal status", async () => {
      const tx = await Transaction.create({
        ...baseFields(),
        status: "pending",
        stellarTxHash: "transition-hash",
      });
      expect(tx.expiresAt).toBeInstanceOf(Date);

      // Simulate a code path that forgets to clear expiresAt — the hook must
      // still rescue the row.
      for (const status of TERMINAL_STATUSES) {
        tx.status = status;
        tx.expiresAt = new Date(Date.now() - 1000); // stale, in the past
        await tx.save();
        expect(tx.expiresAt).toBeUndefined();
      }
    });
  });

  describe("migration", () => {
    it("unsets expiresAt on legacy non-pending rows, keeps pending rows, and is idempotent", async () => {
      // Simulate legacy rows that bypass hooks/defaults (as they were written
      // before the invariant existed).
      await Transaction.collection.insertOne({
        ...baseFields(),
        stellarTxHash: "legacy-confirmed-hash",
        status: "confirmed",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() - 1000), // already past — reaper candidate
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await Transaction.collection.insertOne({
        ...baseFields(),
        stellarTxHash: "legacy-failed-hash",
        status: "failed",
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const pending = await Transaction.create({
        ...baseFields(),
        status: "pending",
        stellarTxHash: "legacy-pending-hash",
      });

      const firstRun = await fixTtlTransactionExpiry();
      expect(firstRun.modifiedCount).toBe(2);

      const rescuedConfirmed = await Transaction.findOne({
        stellarTxHash: "legacy-confirmed-hash",
      });
      expect(rescuedConfirmed).not.toBeNull();
      expect(rescuedConfirmed.expiresAt).toBeUndefined();

      const rescuedFailed = await Transaction.findOne({
        stellarTxHash: "legacy-failed-hash",
      });
      expect(rescuedFailed.expiresAt).toBeUndefined();

      const keptPending = await Transaction.findById(pending._id);
      expect(keptPending.expiresAt).toBeInstanceOf(Date);

      // Idempotent: a second run touches nothing.
      const secondRun = await fixTtlTransactionExpiry();
      expect(secondRun.modifiedCount).toBe(0);
    });

    it("replaces a blanket TTL index with the pending-scoped partial index", async () => {
      // Simulate the pre-fix DB state: blanket TTL index, no partial filter.
      const collection = Transaction.collection;
      const indexes = await collection.indexes();
      const existing = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);
      if (existing) {
        await collection.dropIndex(existing.name);
      }
      await collection.createIndex(
        { expiresAt: 1 },
        { expireAfterSeconds: 0 }
      );

      await fixTtlTransactionExpiry();

      const after = await collection.indexes();
      const ttlIndex = after.find((idx) => idx.key && idx.key.expiresAt === 1);
      expect(ttlIndex).toBeDefined();
      expect(ttlIndex.expireAfterSeconds).toBe(0);
      expect(ttlIndex.partialFilterExpression).toEqual({ status: "pending" });

      // Only one expiresAt index should remain after the swap.
      const expiresAtIndexes = after.filter(
        (idx) => idx.key && idx.key.expiresAt === 1
      );
      expect(expiresAtIndexes).toHaveLength(1);
    });

    it("leaves the already-correct partial index untouched (idempotent index handling)", async () => {
      await fixTtlTransactionExpiry();

      const after = await Transaction.collection.indexes();
      const ttlIndex = after.find((idx) => idx.key && idx.key.expiresAt === 1);
      expect(ttlIndex.partialFilterExpression).toEqual({ status: "pending" });
      expect(ttlIndex.expireAfterSeconds).toBe(0);
    });
  });

  describe("TTL eligibility", () => {
    it("exposes the pending-scoped partial index spec so the reaper can only match pending rows", async () => {
      const indexes = await Transaction.collection.indexes();
      const ttlIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);

      expect(ttlIndex).toBeDefined();
      expect(ttlIndex.expireAfterSeconds).toBe(0);
      expect(ttlIndex.partialFilterExpression).toEqual({ status: "pending" });
    });

    it("survives past the original expiresAt: a confirmed row never carries an expiry", async () => {
      // The regression this issue guards against: a confirmed transaction with
      // an expiresAt in the past is eligible for deletion. With the schema
      // default + pre-save hook, a confirmed row cannot even hold an expiry —
      // and if legacy data still has one, the migration clears it.
      const confirmed = await Transaction.create({
        ...baseFields(),
        status: "confirmed",
        stellarTxHash: "survival-hash",
      });
      expect(confirmed.expiresAt).toBeUndefined();

      await fixTtlTransactionExpiry();
      const persisted = await Transaction.findOne({
        stellarTxHash: "survival-hash",
      });
      expect(persisted).not.toBeNull();
      expect(persisted.expiresAt).toBeUndefined();
    });

    it("does not delete a confirmed row even when legacy data has expiresAt in the past (#6)", async () => {
      // Directly insert a confirmed transaction with an expiresAt that is
      // already in the past — simulating the exact pre-fix state where the
      // TTL reaper would delete confirmed purchases after 30 minutes.
      await Transaction.collection.insertOne({
        ...baseFields(),
        stellarTxHash: "legacy-past-expires-hash",
        status: "confirmed",
        confirmedAt: new Date(),
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // The partial TTL index should NOT match this row (status is confirmed,
      // not pending), so even though expiresAt is in the past the reaper
      // cannot see it.
      const indexes = await Transaction.collection.indexes();
      const ttlIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);
      expect(ttlIndex.partialFilterExpression).toEqual({ status: "pending" });

      const row = await Transaction.findOne({ stellarTxHash: "legacy-past-expires-hash" });
      expect(row).not.toBeNull();
      expect(row.status).toBe("confirmed");

      // After migration, expiresAt should be cleared.
      await fixTtlTransactionExpiry();
      const rescued = await Transaction.findOne({ stellarTxHash: "legacy-past-expires-hash" });
      expect(rescued).not.toBeNull();
      expect(rescued.expiresAt).toBeUndefined();
    });
  });
});
