import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import Transaction from "../src/models/Transaction.js";
import UnreconciledPayment from "../src/models/UnreconciledPayment.js";
import { buildPurchaseMemo, generatePaymentReference } from "../src/services/stellar/paymentReference.js";

// Load/performance coverage for issue #695: reconciliation must do the same
// bounded amount of work whether there are hundreds or thousands of open
// checkouts and catalog items. Work is measured with explain() rather than
// wall-clock time so the suite is deterministic on any CI runner.

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const COLLIDING_SUFFIX = "cafebabe";
const OPEN_STATUSES = ["pending", "submitted", "retrying"];

const mockVerifyPaymentOperations = jest.fn();

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings: jest.fn().mockResolvedValue({ success: true }),
}));

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  toStroops: (amount) => {
    const [whole, frac = ""] = amount.toString().split(".");
    return BigInt(whole || "0") * 10000000n + BigInt((frac + "0000000").slice(0, 7));
  },
  USDC_ISSUER,
  DONATION_WALLET_PUBLIC_KEY: "GDONATIONWALLET123456789",
  verifyPaymentOperations: mockVerifyPaymentOperations,
}));

const {
  reconcilePayment,
  buildCanonicalReferenceQuery,
  buildLegacyReferenceQuery,
  buildTxHashQuery,
} = await import("../src/services/stellar/reconciliationService.js");

const makeKey = (seed) => "G" + String(seed).toUpperCase().padEnd(55, "0").slice(0, 55);

const explain = async (query) => {
  const result = await query.explain("executionStats");
  const report = Array.isArray(result) ? result[0] : result;
  return {
    plan: JSON.stringify(report.queryPlanner.winningPlan),
    docsExamined: report.executionStats.totalDocsExamined,
    keysExamined: report.executionStats.totalKeysExamined,
  };
};

describe("Payment reconciliation at scale (#695)", () => {
  let mongoServer;
  let buyer, author;
  let seededCheckouts = 0;
  let seededBooks = 0;
  let catalogIds = [];

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
    await Promise.all([Transaction.syncIndexes(), UnreconciledPayment.syncIndexes()]);

    buyer = await User.create({
      name: "Scale Buyer",
      email: "scale-buyer@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("SCALEBUYER") },
    });
    author = await User.create({
      name: "Scale Author",
      email: "scale-author@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("SCALEAUTHOR") },
    });
  }, 60000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    mockVerifyPaymentOperations.mockReset().mockResolvedValue({ verified: true });
  });

  /**
   * Grow the catalog. Every fourth book shares the same trailing eight hex
   * characters, so the legacy suffix scheme is maximally collision-prone.
   */
  const growCatalog = async (target) => {
    const books = [];
    for (; seededBooks < target; seededBooks += 1) {
      const prefix = seededBooks.toString(16).padStart(16, "0");
      const suffix = seededBooks % 4 === 0 ? COLLIDING_SUFFIX : seededBooks.toString(16).padStart(8, "0");
      books.push({
        _id: new mongoose.Types.ObjectId(`${prefix}${suffix}`),
        title: `Book ${seededBooks}`,
        price: 25,
        author: author._id,
      });
    }
    if (books.length) {
      await Book.collection.insertMany(books, { ordered: false });
      catalogIds = catalogIds.concat(books.map((b) => b._id));
    }
  };

  /**
   * Grow the open-checkout set across many payers. One in ten rows is a
   * legacy checkout pointing at a colliding-suffix book.
   */
  const growPendingSet = async (target) => {
    const rows = [];
    const now = new Date();
    for (; seededCheckouts < target; seededCheckouts += 1) {
      const isLegacy = seededCheckouts % 10 === 0;
      const reference = generatePaymentReference();
      rows.push({
        buyer: buyer._id,
        buyerWallet: makeKey(`PAYER${seededCheckouts % 500}`),
        creator: author._id,
        creatorWallet: author.stellarWallet.publicKey,
        type: "purchase",
        itemType: "book",
        itemId: catalogIds[seededCheckouts % catalogIds.length],
        itemTypeModel: "Book",
        itemTitle: "Seeded",
        amount: "25",
        currency: "USDC",
        network: "testnet",
        status: OPEN_STATUSES[seededCheckouts % OPEN_STATUSES.length],
        ...(isLegacy
          ? { memo: `DNB-BOOK-${COLLIDING_SUFFIX}` }
          : { paymentReference: reference, memo: buildPurchaseMemo("book", reference) }),
        createdAt: now,
        updatedAt: now,
      });
    }
    if (rows.length) {
      await Transaction.collection.insertMany(rows, { ordered: false });
    }
  };

  const createTarget = (overrides = {}) => {
    const paymentReference = generatePaymentReference();
    return Transaction.create({
      buyer: buyer._id,
      buyerWallet: buyer.stellarWallet.publicKey,
      creator: author._id,
      creatorWallet: author.stellarWallet.publicKey,
      itemType: "book",
      itemId: catalogIds[1],
      itemTypeModel: "Book",
      itemTitle: "Target",
      amount: "25",
      network: "testnet",
      status: "pending",
      paymentReference,
      memo: buildPurchaseMemo("book", paymentReference),
      ...overrides,
    });
  };

  const measureLookups = async () => {
    const target = await createTarget();
    const canonical = await explain(buildCanonicalReferenceQuery(target.paymentReference));
    const legacy = await explain(
      buildLegacyReferenceQuery({
        memo: `DNB-BOOK-${COLLIDING_SUFFIX}`,
        itemType: "book",
        payer: makeKey("PAYER0"),
      })
    );
    const byHash = await explain(buildTxHashQuery("not-yet-seen-hash"));
    await Transaction.deleteOne({ _id: target._id });
    return { canonical, legacy, byHash };
  };

  it("keeps every lookup on an index with constant work as the data grows 10x", async () => {
    await growCatalog(400);
    await growPendingSet(600);
    const small = await measureLookups();

    await growCatalog(4000);
    await growPendingSet(6000);
    const large = await measureLookups();

    for (const { canonical, legacy, byHash } of [small, large]) {
      expect(canonical.plan).toContain("IXSCAN");
      expect(canonical.plan).toContain("paymentReference_1");
      expect(canonical.plan).not.toContain("COLLSCAN");
      expect(canonical.docsExamined).toBe(1);

      expect(legacy.plan).toContain("IXSCAN");
      expect(legacy.plan).toContain("memo_1_itemType_1_status_1_buyerWallet_1");
      expect(legacy.plan).not.toContain("COLLSCAN");
      // Capped by the uniqueness probe no matter how many rows share the memo.
      expect(legacy.docsExamined).toBeLessThanOrEqual(2);

      expect(byHash.plan).toContain("IXSCAN");
      expect(byHash.docsExamined).toBe(0);
    }

    expect(large.canonical.docsExamined).toBe(small.canonical.docsExamined);
    expect(large.legacy.docsExamined).toBe(small.legacy.docsExamined);
    expect(large.canonical.keysExamined).toBe(small.canonical.keysExamined);
  });

  it("settles a payment among thousands of open checkouts without reading the catalog", async () => {
    await growCatalog(4000);
    await growPendingSet(6000);
    const target = await createTarget();
    const bookFind = jest.spyOn(Book, "find");
    const courseFind = jest.spyOn(Course, "find");
    const transactionFind = jest.spyOn(Transaction, "find");

    const result = await reconcilePayment(
      {
        transaction_hash: "scale-hash-1",
        from: buyer.stellarWallet.publicKey,
        to: author.stellarWallet.publicKey,
        amount: "25.0000000",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        type: "payment",
      },
      { memo: target.memo, memo_type: "text", source_account: buyer.stellarWallet.publicKey }
    );

    expect(result.outcome).toBe("confirmed");
    expect(bookFind).not.toHaveBeenCalled();
    expect(courseFind).not.toHaveBeenCalled();
    // One hash probe and one reference probe — never an open-ended scan.
    expect(transactionFind).toHaveBeenCalledTimes(2);
    expect((await Transaction.findById(target._id)).status).toBe("confirmed");
  });

  it("fails closed on a heavily colliding legacy memo regardless of set size", async () => {
    await growCatalog(4000);
    await growPendingSet(6000);
    // PAYER10 owns several legacy checkouts for different colliding books.
    const payer = makeKey("PAYER10");
    expect(
      await Transaction.countDocuments({ memo: `DNB-BOOK-${COLLIDING_SUFFIX}`, buyerWallet: payer })
    ).toBeGreaterThan(1);

    const result = await reconcilePayment(
      {
        transaction_hash: "scale-collision",
        from: payer,
        to: author.stellarWallet.publicKey,
        amount: "25.0000000",
        asset_code: "USDC",
        asset_issuer: USDC_ISSUER,
        type: "payment",
      },
      { memo: `DNB-BOOK-${COLLIDING_SUFFIX}`, memo_type: "text", source_account: payer }
    );

    expect(result).toMatchObject({ outcome: "rejected", reasonCode: "ambiguous_reference" });
    expect(await Transaction.countDocuments({ status: "confirmed", memo: `DNB-BOOK-${COLLIDING_SUFFIX}` })).toBe(0);
  });
});
