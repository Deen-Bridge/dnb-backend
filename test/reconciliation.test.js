import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import User from "../src/models/User.js";
import Book from "../src/models/Book.js";
import Course from "../src/models/Course.js";
import Transaction from "../src/models/Transaction.js";
import UnreconciledPayment from "../src/models/UnreconciledPayment.js";
import IngestionCursor from "../src/models/IngestionCursor.js";
import { buildPurchaseMemo, generatePaymentReference } from "../src/services/stellar/paymentReference.js";
import { registry } from "../src/config/metrics.js";

const mockVerifyPaymentOperations = jest.fn();
const mockRecordSaleEarnings = jest.fn();

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const DONATION_WALLET = "GDONATIONWALLET123456789";

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
  DONATION_WALLET_PUBLIC_KEY: DONATION_WALLET,
  verifyPaymentOperations: mockVerifyPaymentOperations,
}));

const {
  reconcilePayment,
  matchByTxHash,
  resolvePaymentReference,
  grantItemAccess,
} = await import("../src/services/stellar/reconciliationService.js");
const { getReconciliationStatus } = await import("../src/services/stellar/reconciliationHealthService.js");

const makeKey = (prefix) => "G" + prefix.padEnd(55, "0").slice(0, 55).toUpperCase();

// Histogram series (`*_count`) are reported under the base metric name.
const metricValue = async (name, labels = {}) => {
  const baseName = name.replace(/_count$/, "");
  const metric = (await registry.getMetricsAsJSON()).find((m) => m.name === name || m.name === baseName);
  const sample = metric?.values.find(
    (v) =>
      (v.metricName ?? metric.name) === name &&
      Object.entries(labels).every(([key, value]) => v.labels[key] === value)
  );
  return sample?.value ?? 0;
};

describe("Payment Reconciliation Service", () => {
  let mongoServer;
  let buyer, otherBuyer, author, book;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(`${process.env.MONGO_URI}_reconciliation`, { serverSelectionTimeoutMS: 2000 });
      } catch (_err) {
        mongoServer = await MongoMemoryServer.create();
        await mongoose.connect(mongoServer.getUri());
      }
    } else {
      mongoServer = await MongoMemoryServer.create();
      await mongoose.connect(mongoServer.getUri());
    }
    // The unique reference index is part of the contract under test.
    await Promise.all([Transaction.syncIndexes(), UnreconciledPayment.syncIndexes()]);
  }, 30000);

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) await mongoServer.stop();
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all([
      User.deleteMany({}),
      Book.deleteMany({}),
      Course.deleteMany({}),
      Transaction.deleteMany({}),
      UnreconciledPayment.deleteMany({}),
      IngestionCursor.deleteMany({}),
    ]);

    buyer = await User.create({
      name: "Buyer",
      email: "buyer@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("BUYER") },
    });

    otherBuyer = await User.create({
      name: "Other Buyer",
      email: "other@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("OTHERBUYER") },
    });

    author = await User.create({
      name: "Author",
      email: "author@test.com",
      password: "Qx7#vLmp92Zt",
      stellarWallet: { publicKey: makeKey("AUTHOR") },
    });

    book = await createBook();

    mockVerifyPaymentOperations.mockReset();
    mockVerifyPaymentOperations.mockResolvedValue({ verified: true });
    mockRecordSaleEarnings.mockReset();
    mockRecordSaleEarnings.mockResolvedValue({ success: true });
  });

  const createBook = (overrides = {}) =>
    Book.create({
      title: "Test Book",
      description: "A test book",
      category: "Tech",
      price: 25,
      author: author._id,
      thumbnail: "https://example.com/thumb.jpg",
      image: "https://example.com/image.jpg",
      fileUrl: "https://example.com/file.pdf",
      ...overrides,
    });

  const createCheckout = (overrides = {}) =>
    Transaction.create({
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
      ...overrides,
    });

  const createCanonicalCheckout = (overrides = {}) => {
    const paymentReference = generatePaymentReference();
    return createCheckout({
      paymentReference,
      memo: buildPurchaseMemo(overrides.itemType || "book", paymentReference),
      ...overrides,
    });
  };

  const usdcPayment = (overrides = {}) => ({
    transaction_hash: "chain-hash-1",
    from: buyer.stellarWallet.publicKey,
    to: author.stellarWallet.publicKey,
    amount: "25.0000000",
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
    type: "payment",
    ...overrides,
  });

  const txRecordFor = (memo, sourceAccount = buyer.stellarWallet.publicKey) => ({
    memo,
    memo_type: "text",
    source_account: sourceAccount,
  });

  const unreconciledFor = (hash) => UnreconciledPayment.findOne({ stellarTxHash: hash }).lean();

  describe("matchByTxHash", () => {
    it("finds a pending transaction by hash", async () => {
      const tx = await createCheckout({ stellarTxHash: "hash123" });

      const found = await matchByTxHash("hash123");
      expect(found).not.toBeNull();
      expect(found._id.toString()).toBe(tx._id.toString());
    });

    it("returns null for confirmed transactions", async () => {
      await createCheckout({ stellarTxHash: "hash456", status: "confirmed" });

      const found = await matchByTxHash("hash456");
      expect(found).toBeNull();
    });

    it("returns null for unknown hash", async () => {
      const found = await matchByTxHash("nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("resolvePaymentReference", () => {
    it("matches donation memo", async () => {
      const result = await resolvePaymentReference("DNB-SADAQAH", "GBUYERWALLET");
      expect(result).toEqual({ kind: "donation", outcome: "matched" });
    });

    it("resolves a canonical reference to exactly the checkout that minted it", async () => {
      await createCanonicalCheckout();
      const target = await createCanonicalCheckout({ buyer: otherBuyer._id, buyerWallet: otherBuyer.stellarWallet.publicKey });
      await createCanonicalCheckout();

      const result = await resolvePaymentReference(target.memo, otherBuyer.stellarWallet.publicKey);
      expect(result.kind).toBe("canonical");
      expect(result.outcome).toBe("matched");
      expect(result.transaction._id.toString()).toBe(target._id.toString());
    });

    it("rejects a canonical reference whose declared item type disagrees with the checkout", async () => {
      const checkout = await createCanonicalCheckout();
      const courseMemo = buildPurchaseMemo("course", checkout.paymentReference);

      const result = await resolvePaymentReference(courseMemo, buyer.stellarWallet.publicKey);
      expect(result).toMatchObject({ kind: "canonical", outcome: "rejected", reasonCode: "item_type_mismatch" });
    });

    it("reports an unknown canonical reference as not found", async () => {
      const memo = buildPurchaseMemo("book", generatePaymentReference());
      const result = await resolvePaymentReference(memo, buyer.stellarWallet.publicKey);
      expect(result).toMatchObject({ outcome: "rejected", reasonCode: "reference_not_found" });
    });

    it("resolves a legacy memo only through the payer's open checkout", async () => {
      const memo = `DNB-BOOK-${book._id.toString().slice(-8)}`;
      const mine = await createCheckout({ memo });
      await createCheckout({ memo, buyer: otherBuyer._id, buyerWallet: otherBuyer.stellarWallet.publicKey });

      const result = await resolvePaymentReference(memo.toUpperCase(), buyer.stellarWallet.publicKey);
      expect(result.kind).toBe("legacy");
      expect(result.transaction._id.toString()).toBe(mine._id.toString());
    });

    it("fails closed when colliding suffixes leave the payer with two open checkouts", async () => {
      const suffix = "deadbeef";
      const bookA = await createBook({ _id: new mongoose.Types.ObjectId(`aaaaaaaaaaaaaaaa${suffix}`), title: "A" });
      const bookB = await createBook({ _id: new mongoose.Types.ObjectId(`bbbbbbbbbbbbbbbb${suffix}`), title: "B" });
      const memo = `DNB-BOOK-${suffix}`;
      await createCheckout({ memo, itemId: bookA._id, itemTitle: bookA.title });
      await createCheckout({ memo, itemId: bookB._id, itemTitle: bookB.title, status: "retrying" });

      const before = await metricValue("payment_reconciliation_ambiguous_references_total", { scheme: "legacy" });
      const result = await resolvePaymentReference(memo, buyer.stellarWallet.publicKey);

      expect(result).toMatchObject({ kind: "legacy", outcome: "rejected", reasonCode: "ambiguous_reference" });
      expect(await metricValue("payment_reconciliation_ambiguous_references_total", { scheme: "legacy" })).toBe(before + 1);
    });

    it("never falls back to scanning the catalog for legacy memos", async () => {
      const findBooks = jest.spyOn(Book, "find");
      const findCourses = jest.spyOn(Course, "find");
      const memo = `DNB-BOOK-${book._id.toString().slice(-8)}`;

      const result = await resolvePaymentReference(memo, buyer.stellarWallet.publicKey);

      expect(result).toMatchObject({ kind: "legacy", reasonCode: "reference_not_found" });
      expect(findBooks).not.toHaveBeenCalled();
      expect(findCourses).not.toHaveBeenCalled();
    });

    it("does not resolve a legacy memo without a payer", async () => {
      const memo = `DNB-BOOK-${book._id.toString().slice(-8)}`;
      await createCheckout({ memo });

      const result = await resolvePaymentReference(memo, null);
      expect(result).toMatchObject({ reasonCode: "reference_not_found" });
    });

    it("flags malformed DNB references", async () => {
      const result = await resolvePaymentReference("DNB-B-NOTAREFERENCE", "GBUYERWALLET");
      expect(result).toMatchObject({ kind: "malformed", reasonCode: "malformed_reference" });
    });

    it("returns no_reference for unknown or empty memos", async () => {
      expect(await resolvePaymentReference("UNKNOWN-MEMO", "GBUYERWALLET")).toMatchObject({
        kind: "none",
        reasonCode: "no_reference",
      });
      expect(await resolvePaymentReference(null, "GBUYERWALLET")).toMatchObject({ kind: "none" });
    });
  });

  describe("reconcilePayment", () => {
    it("promotes pending transaction via hash match", async () => {
      const tx = await createCheckout({ stellarTxHash: "existing-hash" });

      const paymentRecord = usdcPayment({ transaction_hash: "existing-hash" });
      const txRecord = {
        memo: `DNB-BOOK-${book._id.toString().slice(-8)}`,
        source_account: buyer.stellarWallet.publicKey,
      };

      await reconcilePayment(paymentRecord, txRecord);

      const updated = await Transaction.findById(tx._id);
      expect(updated.status).toBe("confirmed");
      expect(updated.confirmedAt).toBeDefined();
      // Terminal state — the reconciliation confirm path must leave the row
      // without an expiry so the TTL reaper can never delete it.
      expect(updated.expiresAt).toBeUndefined();
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

      const result = await reconcilePayment(paymentRecord, null);

      expect(result).toEqual({ outcome: "ignored" });
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
      expect(unreconciled.reasonCode).toBe("no_reference");
      expect(unreconciled.from).toBe("GUNKNOWN123");
    });

    it("creates confirmed donation from chain data when memo is DNB-SADAQAH", async () => {
      const paymentRecord = usdcPayment({
        transaction_hash: "donation-hash-1",
        to: DONATION_WALLET,
        amount: "10.0000000",
      });

      await reconcilePayment(paymentRecord, txRecordFor("DNB-SADAQAH"));

      const donation = await Transaction.findOne({ stellarTxHash: "donation-hash-1" });
      expect(donation).not.toBeNull();
      expect(donation.type).toBe("donation");
      expect(donation.status).toBe("confirmed");
      expect(donation.buyer.toString()).toBe(buyer._id.toString());
    });

    it("promotes a checkout through its canonical reference and grants access once", async () => {
      const checkout = await createCanonicalCheckout();

      const result = await reconcilePayment(usdcPayment({ ledger: 4242 }), txRecordFor(checkout.memo));

      expect(result).toMatchObject({ outcome: "confirmed" });
      const updated = await Transaction.findById(checkout._id).lean();
      expect(updated).toMatchObject({ status: "confirmed", stellarTxHash: "chain-hash-1", stellarLedger: 4242 });
      expect(updated.reconciledAt).toBeInstanceOf(Date);
      expect(updated.expiresAt).toBeUndefined();
      expect(mockVerifyPaymentOperations).toHaveBeenCalledWith(
        "chain-hash-1",
        [{ destination: author.stellarWallet.publicKey, amount: "25" }],
        "USDC"
      );

      const owner = await User.findById(buyer._id).lean();
      expect(owner.purchasedBooks.map((p) => p.bookId.toString())).toEqual([book._id.toString()]);
      expect(await UnreconciledPayment.countDocuments()).toBe(0);
    });

    it("treats duplicate Horizon events as idempotent", async () => {
      const checkout = await createCanonicalCheckout();
      const payment = usdcPayment();
      const txRecord = txRecordFor(checkout.memo);

      const first = await reconcilePayment(payment, txRecord);
      const second = await reconcilePayment(payment, txRecord);

      expect(first.outcome).toBe("confirmed");
      expect(second.outcome).toBe("duplicate");
      expect(await Transaction.countDocuments()).toBe(1);
      expect(await UnreconciledPayment.countDocuments()).toBe(0);
      const owner = await User.findById(buyer._id).lean();
      expect(owner.purchasedBooks).toHaveLength(1);
      expect(owner.stat.booksRead).toBe(1);
    });

    it("lets exactly one concurrent worker settle a checkout", async () => {
      const checkout = await createCanonicalCheckout();
      const payment = usdcPayment();
      const txRecord = txRecordFor(checkout.memo);

      const results = await Promise.all(
        Array.from({ length: 4 }, () => reconcilePayment(payment, txRecord))
      );

      const outcomes = results.map((r) => r.outcome).sort();
      expect(outcomes.filter((o) => o === "confirmed")).toHaveLength(1);
      expect(outcomes.filter((o) => o === "duplicate")).toHaveLength(3);
      const owner = await User.findById(buyer._id).lean();
      expect(owner.purchasedBooks).toHaveLength(1);
    });

    it("finishes interrupted follow-up effects when an event is replayed", async () => {
      const checkout = await createCanonicalCheckout();
      mockRecordSaleEarnings.mockRejectedValueOnce(new Error("ledger unavailable"));

      await expect(reconcilePayment(usdcPayment(), txRecordFor(checkout.memo))).rejects.toThrow("ledger unavailable");
      expect((await Transaction.findById(checkout._id)).status).toBe("confirmed");
      expect((await User.findById(buyer._id).lean()).purchasedBooks).toHaveLength(0);

      // A replay inside the grace window could race a live worker, so it
      // leaves effects alone.
      expect((await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo))).outcome).toBe("duplicate");
      expect(mockRecordSaleEarnings).toHaveBeenCalledTimes(1);

      // The next replay after the window finishes the interrupted work.
      await Transaction.updateOne(
        { _id: checkout._id },
        { $set: { reconciledAt: new Date(Date.now() - 5 * 60 * 1000) } }
      );
      const replay = await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo));

      expect(replay.outcome).toBe("duplicate");
      expect(mockRecordSaleEarnings).toHaveBeenCalledTimes(2);
      expect((await User.findById(buyer._id).lean()).purchasedBooks).toHaveLength(1);
    });

    it("does not re-grant access on a replay for a refunded purchase", async () => {
      const checkout = await createCanonicalCheckout({
        status: "refunded",
        stellarTxHash: "chain-hash-1",
        reconciledAt: new Date(),
      });

      const result = await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo));

      expect(result.outcome).toBe("duplicate");
      expect(mockRecordSaleEarnings).not.toHaveBeenCalled();
      expect((await User.findById(buyer._id).lean()).purchasedBooks).toHaveLength(0);
    });

    it("promotes an in-flight legacy checkout by exact memo and payer", async () => {
      const memo = `DNB-BOOK-${book._id.toString().slice(-8)}`;
      const checkout = await createCheckout({ memo });

      const result = await reconcilePayment(usdcPayment(), txRecordFor(memo));

      expect(result.outcome).toBe("confirmed");
      expect((await Transaction.findById(checkout._id)).status).toBe("confirmed");
    });

    it("persists a suffix collision as ambiguous and promotes nothing", async () => {
      const suffix = "c011151e";
      const bookA = await createBook({ _id: new mongoose.Types.ObjectId(`1111111111111111${suffix}`), title: "A" });
      const bookB = await createBook({ _id: new mongoose.Types.ObjectId(`2222222222222222${suffix}`), title: "B" });
      const memo = `DNB-BOOK-${suffix}`;
      await createCheckout({ memo, itemId: bookA._id });
      await createCheckout({ memo, itemId: bookB._id, status: "submitted" });

      const result = await reconcilePayment(usdcPayment({ transaction_hash: "collision-hash" }), txRecordFor(memo));

      expect(result).toMatchObject({ outcome: "rejected", reasonCode: "ambiguous_reference" });
      expect(await Transaction.countDocuments({ status: "confirmed" })).toBe(0);
      const row = await unreconciledFor("collision-hash");
      expect(row).toMatchObject({ reasonCode: "ambiguous_reference", referenceKind: "legacy", attempts: 1 });
      expect(row.reason).toMatch(/manually/);
    });

    it("records a legacy memo with no open checkout instead of buying from the catalog", async () => {
      const memo = `DNB-BOOK-${book._id.toString().slice(-8)}`;

      const result = await reconcilePayment(usdcPayment(), txRecordFor(memo));

      expect(result.reasonCode).toBe("reference_not_found");
      expect(await Transaction.countDocuments()).toBe(0);
      expect((await User.findById(buyer._id).lean()).purchasedBooks).toHaveLength(0);
    });

    it("rejects a canonical reference presented with the wrong item type", async () => {
      const checkout = await createCanonicalCheckout();
      const wrongType = buildPurchaseMemo("course", checkout.paymentReference);

      const result = await reconcilePayment(usdcPayment(), txRecordFor(wrongType));

      expect(result.reasonCode).toBe("item_type_mismatch");
      expect((await unreconciledFor("chain-hash-1")).transaction.toString()).toBe(checkout._id.toString());
      expect((await Transaction.findById(checkout._id)).status).toBe("pending");
    });

    it("persists malformed references with an actionable reason", async () => {
      const result = await reconcilePayment(usdcPayment(), txRecordFor("DNB-C-TOO-SHORT"));

      expect(result.reasonCode).toBe("malformed_reference");
      expect(await unreconciledFor("chain-hash-1")).toMatchObject({
        reasonCode: "malformed_reference",
        referenceKind: "malformed",
      });
    });

    it("ignores memos that are not text memos", async () => {
      const checkout = await createCanonicalCheckout();

      const result = await reconcilePayment(usdcPayment(), { ...txRecordFor(checkout.memo), memo_type: "hash" });

      expect(result.reasonCode).toBe("no_reference");
    });

    describe("payment must agree with the checkout", () => {
      it.each([
        ["source account", {}, { source: makeKey("STRANGER") }, "source_mismatch"],
        ["destination", {}, { payment: { to: makeKey("ELSEWHERE") } }, "destination_mismatch"],
        ["amount", {}, { payment: { amount: "24.9999999" } }, "amount_mismatch"],
        ["network", { network: "mainnet" }, {}, "network_mismatch"],
        ["asset issuer", { assetIssuer: makeKey("FAKEISSUER") }, {}, "asset_mismatch"],
        ["status", { status: "expired" }, {}, "transaction_not_reconcilable"],
        ["bound hash", { stellarTxHash: "another-hash", status: "submitted" }, {}, "reference_hash_mismatch"],
      ])("rejects a mismatched %s", async (_label, checkoutOverrides, { source, payment = {} }, reasonCode) => {
        const checkout = await createCanonicalCheckout(checkoutOverrides);

        const result = await reconcilePayment(
          usdcPayment(payment),
          txRecordFor(checkout.memo, source)
        );

        expect(result).toMatchObject({ outcome: "rejected", reasonCode });
        expect(mockVerifyPaymentOperations).not.toHaveBeenCalled();
        const reloaded = await Transaction.findById(checkout._id).lean();
        expect(reloaded.status).toBe(checkoutOverrides.status || "pending");
        expect((await unreconciledFor("chain-hash-1")).reasonCode).toBe(reasonCode);
      });

      it("accepts the platform-fee leg of a split payment", async () => {
        const platformWallet = makeKey("PLATFORM");
        const checkout = await createCanonicalCheckout({
          platformFee: { feePercent: 10, platformWallet, platformAmount: "2.5", creatorAmount: "22.5" },
        });

        const result = await reconcilePayment(
          usdcPayment({ to: platformWallet, amount: "2.5000000" }),
          txRecordFor(checkout.memo)
        );

        expect(result.outcome).toBe("confirmed");
        expect(mockVerifyPaymentOperations).toHaveBeenCalledWith(
          "chain-hash-1",
          [
            { destination: author.stellarWallet.publicKey, amount: "22.5" },
            { destination: platformWallet, amount: "2.5" },
          ],
          "USDC"
        );
      });

      it("rejects when the purchased item no longer exists", async () => {
        const checkout = await createCanonicalCheckout();
        await Book.deleteOne({ _id: book._id });

        const result = await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo));
        expect(result.reasonCode).toBe("item_not_found");
      });

      it("distinguishes failed from unavailable on-chain verification", async () => {
        const checkout = await createCanonicalCheckout();

        mockVerifyPaymentOperations.mockResolvedValueOnce({ verified: false, reason: "Missing expected USDC payment" });
        expect((await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo))).reasonCode).toBe("verification_failed");

        mockVerifyPaymentOperations.mockResolvedValueOnce({ verified: false, transient: true });
        expect((await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo))).reasonCode).toBe("verification_unavailable");

        const row = await unreconciledFor("chain-hash-1");
        expect(row).toMatchObject({ reasonCode: "verification_unavailable", attempts: 2 });
      });

      it("treats the fee-bump hash of a sponsored, already-confirmed purchase as a duplicate", async () => {
        const checkout = await createCanonicalCheckout({
          status: "confirmed",
          sponsored: true,
          stellarTxHash: "inner-hash",
          feeBumpTxHash: "outer-hash",
        });

        const result = await reconcilePayment(usdcPayment({ transaction_hash: "outer-hash" }), txRecordFor(checkout.memo));

        expect(result.outcome).toBe("duplicate");
        expect(await UnreconciledPayment.countDocuments()).toBe(0);
      });

      it("settles a sponsored checkout under its inner hash when Horizon reports the fee-bump hash", async () => {
        const checkout = await createCanonicalCheckout({
          status: "retrying",
          sponsored: true,
          stellarTxHash: "inner-hash",
          feeBumpTxHash: "outer-hash",
        });

        const result = await reconcilePayment(usdcPayment({ transaction_hash: "outer-hash" }), txRecordFor(checkout.memo));

        expect(result.outcome).toBe("confirmed");
        expect(mockVerifyPaymentOperations).toHaveBeenCalledWith("inner-hash", expect.any(Array), "USDC");
        const reloaded = await Transaction.findById(checkout._id).lean();
        expect(reloaded).toMatchObject({ status: "confirmed", stellarTxHash: "inner-hash", feeBumpTxHash: "outer-hash" });
      });

      it("rejects a second payment against an already-settled reference", async () => {
        const checkout = await createCanonicalCheckout({ status: "confirmed", stellarTxHash: "first-payment" });

        const result = await reconcilePayment(usdcPayment({ transaction_hash: "second-payment" }), txRecordFor(checkout.memo));

        expect(result.reasonCode).toBe("reference_already_settled");
        expect((await unreconciledFor("second-payment")).transaction.toString()).toBe(checkout._id.toString());
      });
    });

    it("marks a previously unreconciled payment resolved once it settles", async () => {
      const checkout = await createCanonicalCheckout();
      mockVerifyPaymentOperations.mockResolvedValueOnce({ verified: false, transient: true });

      await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo));
      expect((await unreconciledFor("chain-hash-1")).resolvedAt).toBeUndefined();

      const retry = await reconcilePayment(usdcPayment(), txRecordFor(checkout.memo));

      expect(retry.outcome).toBe("confirmed");
      expect((await unreconciledFor("chain-hash-1")).resolvedAt).toBeInstanceOf(Date);
      expect((await getReconciliationStatus()).backlog.unreconciledCount).toBe(0);
    });

    it("persists lookup timeouts instead of losing the payment", async () => {
      const timeout = Object.assign(new Error("operation exceeded time limit"), { code: 50 });
      jest.spyOn(Transaction, "find").mockImplementationOnce(() => ({
        limit: () => ({ maxTimeMS: () => Promise.reject(timeout) }),
      }));
      const before = await metricValue("payment_reconciliation_unreconciled_total", { reason: "lookup_failed" });

      const result = await reconcilePayment(usdcPayment(), txRecordFor("DNB-SADAQAH"));

      expect(result.reasonCode).toBe("lookup_failed");
      expect((await unreconciledFor("chain-hash-1")).reasonCode).toBe("lookup_failed");
      expect(await metricValue("payment_reconciliation_unreconciled_total", { reason: "lookup_failed" })).toBe(before + 1);
    });

    it("records lookup duration and rejected-reference metrics", async () => {
      const lookupsBefore = await metricValue("payment_reconciliation_lookup_duration_seconds_count", {
        strategy: "canonical",
        outcome: "not_found",
      });
      const rejectedBefore = await metricValue("payment_reconciliation_rejected_references_total", {
        reason: "reference_not_found",
      });

      await reconcilePayment(usdcPayment(), txRecordFor(buildPurchaseMemo("book", generatePaymentReference())));

      expect(
        await metricValue("payment_reconciliation_lookup_duration_seconds_count", { strategy: "canonical", outcome: "not_found" })
      ).toBe(lookupsBefore + 1);
      expect(
        await metricValue("payment_reconciliation_rejected_references_total", { reason: "reference_not_found" })
      ).toBe(rejectedBefore + 1);
    });

    describe("donations", () => {
      it("is idempotent across duplicate events", async () => {
        const payment = usdcPayment({ transaction_hash: "donation-dup", to: DONATION_WALLET, amount: "5.0000000" });

        const first = await reconcilePayment(payment, txRecordFor("DNB-SADAQAH"));
        const second = await reconcilePayment(payment, txRecordFor("DNB-SADAQAH"));

        expect(first.outcome).toBe("confirmed");
        expect(second.outcome).toBe("duplicate");
        expect(await Transaction.countDocuments({ stellarTxHash: "donation-dup" })).toBe(1);
      });

      it("rejects the donation memo on a payment to another wallet", async () => {
        const result = await reconcilePayment(usdcPayment(), txRecordFor("DNB-SADAQAH"));

        expect(result.reasonCode).toBe("destination_mismatch");
        expect(await Transaction.countDocuments()).toBe(0);
      });

      it("rejects donations from wallets that are not linked to a user", async () => {
        const result = await reconcilePayment(
          usdcPayment({ to: DONATION_WALLET, from: makeKey("ANON") }),
          txRecordFor("DNB-SADAQAH", makeKey("ANON"))
        );
        expect(result.reasonCode).toBe("unknown_donor");
      });
    });
  });

  describe("grantItemAccess", () => {
    it("does not duplicate ownership or stats when called repeatedly", async () => {
      await grantItemAccess({ buyerId: buyer._id, itemType: "book", itemId: book._id });
      await grantItemAccess({ buyerId: buyer._id, itemType: "book", itemId: book._id });

      const owner = await User.findById(buyer._id).lean();
      expect(owner.purchasedBooks).toHaveLength(1);
      expect(owner.stat.booksRead).toBe(1);
    });

    it("throws a clear error for a missing buyer", async () => {
      await expect(
        grantItemAccess({ buyerId: new mongoose.Types.ObjectId(), itemType: "book", itemId: book._id })
      ).rejects.toThrow(/buyer .* not found/);
    });
  });
});
