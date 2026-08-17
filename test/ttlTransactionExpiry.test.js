import { jest } from "@jest/globals";
import mongoose from "mongoose";
import Transaction from "../src/models/Transaction.js";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import { fixTtlTransactionExpiry } from "../src/migrations/fixTtlTransactionExpiry.js";

describe("Transaction TTL Expiry & Lifecycle Invariants", () => {
  let buyer, author, book;

  beforeAll(async () => {
    const uri = process.env.MONGO_URI || "mongodb://127.0.0.1:27017/dnb-backend-test";
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(uri);
    }
  });

  afterAll(async () => {
    await mongoose.disconnect();
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
      password: "Password123#Valid",
      stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
    });

    author = await User.create({
      name: "Author User",
      email: "author_ttl@example.com",
      password: "Password123#Valid",
      stellarWallet: { publicKey: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5" },
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

  it("should assign expiresAt by default for pending transactions", async () => {
    const tx = await Transaction.create({
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
      status: "pending",
    });

    expect(tx.expiresAt).toBeInstanceOf(Date);
    expect(tx.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("should NOT assign expiresAt when created directly with confirmed status", async () => {
    const tx = await Transaction.create({
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
      status: "confirmed",
    });

    expect(tx.expiresAt).toBeUndefined();
  });

  it("should migration unset expiresAt on legacy non-pending transactions and ensure partial index", async () => {
    // Manually create non-pending transactions that simulate legacy rows with expiresAt
    const legacyConfirmed = new Transaction({
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
      status: "confirmed",
      expiresAt: new Date(Date.now() - 1000), // in the past
    });
    await legacyConfirmed.save();

    const legacyPending = new Transaction({
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
      status: "pending",
      expiresAt: new Date(Date.now() + 60000),
    });
    await legacyPending.save();

    // Run migration
    const result = await fixTtlTransactionExpiry();
    expect(result.modifiedCount).toBe(1);

    // Verify confirmed row has expiresAt unset
    const updatedConfirmed = await Transaction.findById(legacyConfirmed._id);
    expect(updatedConfirmed.expiresAt).toBeUndefined();

    // Verify pending row retains its expiresAt
    const updatedPending = await Transaction.findById(legacyPending._id);
    expect(updatedPending.expiresAt).toBeInstanceOf(Date);

    // Verify index definition on collection
    const indexes = await Transaction.collection.indexes();
    const ttlIndex = indexes.find((idx) => idx.key && idx.key.expiresAt === 1);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex.partialFilterExpression).toEqual({ status: "pending" });
    expect(ttlIndex.expireAfterSeconds).toBe(0);
  });
});
