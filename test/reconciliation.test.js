import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Transaction from "../src/models/Transaction.js";
import UnreconciledPayment from "../src/models/UnreconciledPayment.js";
import IngestionCursor from "../src/models/IngestionCursor.js";

const mockVerifyPaymentOperations = jest.fn();
const mockRecordSaleEarnings = jest.fn();

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings: mockRecordSaleEarnings,
}));

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  toStroops: (amount) => {
    const [whole, frac = ""] = amount.toString().split(".");
    return (
      BigInt(whole || "0") * 10000000n +
      BigInt((frac + "0000000").slice(0, 7))
    );
  },
  USDC_ISSUER,
  DONATION_WALLET_PUBLIC_KEY: "GDONATIONWALLET123456789",
  verifyPaymentOperations: mockVerifyPaymentOperations,
}));

const {
  reconcilePayment,
  matchByTxHash,
  matchByMemo,
  getReconciliationStatus,
  grantItemAccess,
} = await import("../src/services/stellar/reconciliationService.js");

describe("Payment Reconciliation Service", () => {
  let mongoServer;
  let buyer, author, admin, book, course;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(`${process.env.MONGO_URI}_reconciliation`, { serverSelectionTimeoutMS: 2000 });
        return;
      } catch (_err) {}
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Book.deleteMany({}),
      Transaction.deleteMany({}),
      UnreconciledPayment.deleteMany({}),
      IngestionCursor.deleteMany({}),
    ]);

    const makeKey = (prefix) => {
      const p = prefix.padEnd(55, "0").slice(0, 55).toUpperCase();
      return "G" + p;
    };

    buyer = await User.create({
      name: "Buyer",
      email: "buyer@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("BUYER") },
    });

    author = await User.create({
      name: "Author",
      email: "author@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("AUTHOR") },
    });

    book = await Book.create({
      title: "Test Book",
      description: "A test book",
      category: "Tech",
      price: 25,
      author: author._id,
      thumbnail: "https://example.com/thumb.jpg",
      image: "https://example.com/image.jpg",
      fileUrl: "https://example.com/file.pdf",
    });

    mockVerifyPaymentOperations.mockReset();
    mockRecordSaleEarnings.mockReset();
    mockRecordSaleEarnings.mockResolvedValue({ success: true });
  });

  describe("matchByTxHash", () => {
    it("finds a pending transaction by hash", async () => {
      const tx = await Transaction.create({
        stellarTxHash: "hash123",
        buyer: buyer._id,
        buyerWallet: buyer.stellarWallet.publicKey,
        creator: author._id,
        creatorWallet: author.stellarWallet.publicKey,
        itemType: "book",
        itemId: book._id,
        itemTypeModel: "Book",
        itemTitle: book.title,
        amount: "25",
        network: "testnet",
        status: "pending",
      });

      const found = await matchByTxHash("hash123");
      expect(found).not.toBeNull();
      expect(found._id.toString()).toBe(tx._id.toString());
    });

    it("returns null for confirmed transactions", async () => {
      await Transaction.create({
        stellarTxHash: "hash456",
        buyer: buyer._id,
        buyerWallet: buyer.stellarWallet.publicKey,
        creator: author._id,
        creatorWallet: author.stellarWallet.publicKey,
        itemType: "book",
        itemId: book._id,
        itemTypeModel: "Book",
        itemTitle: book.title,
        amount: "25",
        network: "testnet",
        status: "confirmed",
      });

      const found = await matchByTxHash("hash456");
      expect(found).toBeNull();
    });

    it("returns null for unknown hash", async () => {
      const found = await matchByTxHash("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("matchByMemo", () => {
    it("matches donation memo", async () => {
      const result = await matchByMemo("DNB-SADAQAH", "GBUYERWALLET");
      expect(result).toEqual({ type: "donation", sourceAccount: "GBUYERWALLET" });
    });

    it("matches purchase memo to pending transaction", async () => {
      const itemIdStr = book._id.toString();
      const memo = `DNB-BOOK-${itemIdStr.slice(-8)}`;

      await Transaction.create({
        stellarTxHash: "pending-hash",
        buyer: buyer._id,
        buyerWallet: buyer.stellarWallet.publicKey,
        creator: author._id,
        creatorWallet: author.stellarWallet.publicKey,
        itemType: "book",
        itemId: book._id,
        itemTypeModel: "Book",
        itemTitle: book.title,
        amount: "25",
        network: "testnet",
        status: "pending",
      });

      const result = await matchByMemo(memo, buyer.stellarWallet.publicKey);
      expect(result).not.toBeNull();
      expect(result._id).toBeDefined();
      expect(result.status).toBe("pending");
    });

    it("falls back to item lookup when no pending transaction exists", async () => {
      const itemIdStr = book._id.toString();
      const memo = `DNB-BOOK-${itemIdStr.slice(-8)}`;

      const result = await matchByMemo(memo, buyer.stellarWallet.publicKey);
      expect(result).not.toBeNull();
      expect(result.type).toBe("purchase");
      expect(result.itemType).toBe("book");
      expect(result.itemId.toString()).toBe(book._id.toString());
    });

    it("returns null for unknown memo", async () => {
      const result = await matchByMemo("UNKNOWN-MEMO", "GBUYERWALLET");
      expect(result).toBeNull();
    });

    it("returns null for empty memo", async () => {
      const result = await matchByMemo(null, "GBUYERWALLET");
      expect(result).toBeNull();
    });
  });

  describe("reconcilePayment", () => {
    it("promotes pending transaction via hash match", async () => {
      const tx = await Transaction.create({
        stellarTxHash: "existing-hash",
        buyer: buyer._id,
        buyerWallet: buyer.stellarWallet.publicKey,
        creator: author._id,
        creatorWallet: author.stellarWallet.publicKey,
        itemType: "book",
        itemId: book._id,
        itemTypeModel: "Book",
        itemTitle: book.title,
        amount: "25",
        network: "testnet",
        status: "pending",
      });

      mockVerifyPaymentOperations.mockResolvedValue({ verified: true });
      mockRecordSaleEarnings.mockResolvedValue({ success: true });

      const paymentRecord = {
        transaction_hash: "existing-hash",
        from: buyer.stellarWallet.publicKey,
        to: author.stellarWallet.publicKey,
        amount: "25.0000000",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        type: "payment",
      };

      const txRecord = {
        memo: `DNB-BOOK-${book._id.toString().slice(-8)}`,
        source_account: buyer.stellarWallet.publicKey,
      };

      await reconcilePayment(paymentRecord, txRecord);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe("confirmed");
      expect(updated.confirmedAt).toBeDefined();
      expect(mockRecordSaleEarnings).toHaveBeenCalled();
    });

    it("skips non-USDC payments", async () => {
      const paymentRecord = {
        transaction_hash: "non-usdc-hash",
        from: "GABC",
        to: "GDEF",
        amount: "100.0000000",
        asset_code: "XLM",
        type: "payment",
      };

      await reconcilePayment(paymentRecord, null);

      const unreconciled = await UnreconciledPayment.countDocuments();
      expect(unreconciled).toBe(0);
    });

    it("writes UnreconciledPayment when no match is found", async () => {
      mockVerifyPaymentOperations.mockResolvedValue({ verified: false });

      const paymentRecord = {
        transaction_hash: "unmatched-hash",
        from: "GUNKNOWN123",
        to: "GDEST456",
        amount: "50.0000000",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        type: "payment",
      };

      const txRecord = {
        memo: "SOME-RANDOM-MEMO",
        source_account: "GUNKNOWN123",
      };

      await reconcilePayment(paymentRecord, txRecord);

      const unreconciled = await UnreconciledPayment.findOne({ stellarTxHash: "unmatched-hash" });
      expect(unreconciled).not.toBeNull();
      expect(unreconciled.reason).toBeDefined();
      expect(unreconciled.from).toBe("GUNKNOWN123");
    });

    it("creates confirmed donation from chain data when memo is DNB-SADAQAH", async () => {
      const paymentRecord = {
        transaction_hash: "donation-hash-1",
        from: buyer.stellarWallet.publicKey,
        to: "GDONATIONWALLET123456789",
        amount: "10.0000000",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        type: "payment",
      };

      const txRecord = {
        memo: "DNB-SADAQAH",
        source_account: buyer.stellarWallet.publicKey,
      };

      await reconcilePayment(paymentRecord, txRecord);

      const donation = await Transaction.findOne({ stellarTxHash: "donation-hash-1" });
      expect(donation).not.toBeNull();
      expect(donation.type).toBe("donation");
      expect(donation.status).toBe("confirmed");
      expect(donation.buyer.toString()).toBe(buyer._id.toString());
    });
  });

  describe("getReconciliationStatus", () => {
    it("returns cursor positions and counts", async () => {
      await IngestionCursor.create({
        account: "GPLATFORM123",
        cursor: "12345-1",
        lastSyncAt: new Date(),
      });

      await UnreconciledPayment.create({
        stellarTxHash: "bad-hash",
        from: "GABC",
        to: "GDEF",
        amount: "100",
        reason: "No match found",
      });

      const status = await getReconciliationStatus();
      expect(Array.isArray(status.cursors)).toBe(true);
      expect(status.cursors).toHaveLength(1);
      expect(status.cursors[0].account).toBe("GPLATFORM123");
      expect(status.cursors[0].cursor).toBe("12345-1");
      expect(status.unreconciledCount).toBe(1);
    });
  });
});
