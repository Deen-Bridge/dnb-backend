import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

const buildPaymentTransaction = jest.fn();
const buildSep7Uri = jest.fn();
const calculateFeeSplit = jest.fn();
const preflightPayment = jest.fn();
const submitTransaction = jest.fn();
const verifyPaymentOperations = jest.fn();
const getExplorerUrl = jest.fn((hash) => `https://stellar.expert/tx/${hash}`);
const recordSaleEarnings = jest.fn();
const enqueue = jest.fn();
const grantItemAccess = jest.fn();

// Mirrors every named export of stellarService.js (see the comment in
// stellarPaymentController.test.js for why the full surface is needed).
jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  STROOPS_PER_UNIT: 10000000n,
  toStroops: jest.fn(),
  fromStroops: jest.fn(),
  applySlippage: jest.fn(),
  findPaymentPaths: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  calculateFeeSplit,
  buildSep7Uri,
  isValidPublicKey: jest.fn(),
  getAccountBalance: jest.fn(),
  MEMO_REQUIRED_DATA_KEY: "config.memo_required",
  isMemoRequired: jest.fn(),
  PREFLIGHT_REASON_CODES: {},
  preflightPayment,
  buildPaymentTransaction,
  buildReversePaymentTransaction: jest.fn(),
  submitTransaction,
  verifyTransaction: jest.fn(),
  verifyPaymentOperations,
  validateSignedPaymentXdr: jest.fn(),
  hasUsdcTrustline: jest.fn(),
  getExplorerUrl,
  getAccountExplorerUrl: jest.fn(),
  server: {},
  USDC: "USDC",
  USDC_ISSUER: "",
  NETWORK: "testnet",
  networkPassphrase: TESTNET_PASSPHRASE,
  DONATION_WALLET_PUBLIC_KEY: "",
  PLATFORM_FEE_PERCENT: 0,
  PLATFORM_WALLET_PUBLIC_KEY: "",
}));

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings,
}));

jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  enqueue,
}));

// grantItemAccess is what must NOT run twice on a replayed submit — mock it
// so the test can count invocations.
jest.unstable_mockModule("../src/services/stellar/reconciliationService.js", () => ({
  grantItemAccess,
}));

const { initializePayment, submitPayment } = await import(
  "../src/controllers/stellar/paymentController.js"
);
const User = (await import("../src/models/User.js")).default;
const Book = (await import("../src/models/Book.js")).default;
const Transaction = (await import("../src/models/Transaction.js")).default;

const makeQuery = (result) => {
  const query = {
    session: jest.fn(() => Promise.resolve(result)),
    populate: jest.fn(() => query),
    select: jest.fn(() => query),
    sort: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
};

const makeSession = () => ({
  startTransaction: jest.fn(),
  commitTransaction: jest.fn(() => Promise.resolve()),
  abortTransaction: jest.fn(() => Promise.resolve()),
  endSession: jest.fn(),
});

const mountPaymentApp = (userId) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: userId };
    next();
  });
  app.post("/initialize", initializePayment);
  app.post("/submit", submitPayment);
  return app;
};

// A real, valid Stellar destination (the SDK validates the key format when
// building the operation).
const DESTINATION = StellarSdk.Keypair.random().publicKey();

// Build a real, signed USDC payment transaction (testnet passphrase) so the
// controller can parse it and derive a deterministic on-chain hash.
const buildSignedXdr = ({ amount = "15" } = {}) => {
  const source = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(source.publicKey(), "1");
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: DESTINATION,
        asset: new StellarSdk.Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"),
        amount,
      })
    )
    .addMemo(StellarSdk.Memo.text("DNB-BOOK-1234"))
    .setTimeout(300)
    .build();
  tx.sign(source);
  return { xdr: tx.toXDR(), hash: tx.hash().toString("hex") };
};

describe("Stellar payment idempotency", () => {
  let buyerId;
  let creatorId;
  let itemId;
  let buyerWallet;
  let creatorWallet;
  let session;
  let savedTransactions;

  beforeEach(() => {
    jest.restoreAllMocks();
    buildPaymentTransaction.mockReset();
    buildSep7Uri.mockReset();
    calculateFeeSplit.mockReset().mockReturnValue(null);
    preflightPayment.mockReset().mockResolvedValue({ ok: true });
    submitTransaction.mockReset();
    verifyPaymentOperations.mockReset();
    getExplorerUrl.mockClear();
    recordSaleEarnings.mockReset();
    enqueue.mockReset().mockResolvedValue(undefined);
    grantItemAccess.mockReset().mockResolvedValue(undefined);

    buyerId = new mongoose.Types.ObjectId();
    creatorId = new mongoose.Types.ObjectId();
    itemId = new mongoose.Types.ObjectId();
    buyerWallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
    creatorWallet = "GCKFBEIYTKPXL5UIRZ5OO3KSOFDP5D4R6YGNFWEQSIFGKWO3EZ5F3TGI";
    session = makeSession();
    savedTransactions = [];

    jest.spyOn(mongoose, "startSession").mockResolvedValue(session);
    jest.spyOn(Transaction.prototype, "save").mockImplementation(function () {
      savedTransactions.push(this);
      return Promise.resolve(this);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns the existing pending record instead of creating a duplicate on re-initialize", async () => {
    const buyer = {
      _id: buyerId,
      stellarWallet: { publicKey: buyerWallet },
      purchasedBooks: [],
    };
    const creator = {
      _id: creatorId,
      name: "Educator",
      stellarWallet: { publicKey: creatorWallet },
    };
    const book = {
      _id: itemId,
      title: "Paid Book",
      price: 15,
      author: creator,
    };
    const existingTx = {
      _id: new mongoose.Types.ObjectId(),
      unsignedXdr: "unsigned-xdr-from-first-init",
      expectedHash: "expected-hash",
    };

    jest.spyOn(User, "findById").mockReturnValue(makeQuery(buyer));
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(existingTx));

    const res = await request(mountPaymentApp(buyerId))
      .post("/initialize")
      .send({
        itemType: "book",
        itemId: itemId.toString(),
        buyerWallet,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      alreadyPending: true,
      transactionId: existingTx._id.toString(),
      payment: {
        xdr: "unsigned-xdr-from-first-init",
        networkPassphrase: TESTNET_PASSPHRASE,
        expectedHash: "expected-hash",
      },
    });
    // No XDR was built and no new document was saved.
    expect(buildPaymentTransaction).not.toHaveBeenCalled();
    expect(savedTransactions).toHaveLength(0);
    expect(session.abortTransaction).toHaveBeenCalled();
  });

  it("replays the original success response on a duplicate submit of the same signed XDR", async () => {
    const signed = buildSignedXdr();
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      buyerWallet,
      creator: creatorId,
      creatorWallet,
      itemType: "book",
      itemId,
      itemTitle: "Paid Book",
      amount: "15",
      currency: "USDC",
      status: "pending",
      memo: "DNB-BOOK-1234",
      save: jest.fn(() => Promise.resolve()),
    };

    // findOne is called for both the confirmed-by-hash lookup and the pending
    // lookup; the same object is returned so the second submit sees it already
    // confirmed (status flipped by the first submit).
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockResolvedValue({
      hash: signed.hash,
      ledger: 77,
      successful: true,
    });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    recordSaleEarnings.mockResolvedValue({ success: true });

    const app = mountPaymentApp(buyerId);

    // First submit — normal confirmation.
    const first = await request(app)
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: signed.xdr });
    expect(first.statusCode).toBe(200);
    expect(first.body).toMatchObject({
      success: true,
      message: "Payment successful!",
    });
    expect(tx.status).toBe("confirmed");
    expect(tx.stellarTxHash).toBe(signed.hash);

    // Second submit — same XDR, must be recognized as already processed.
    const second = await request(app)
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: signed.xdr });
    expect(second.statusCode).toBe(200);
    expect(second.body).toMatchObject({
      success: true,
      replay: true,
      message: "Payment already processed",
      transaction: {
        hash: signed.hash,
        itemTitle: "Paid Book",
        amount: "15",
      },
    });

    // Access is granted exactly once across both submits.
    expect(grantItemAccess).toHaveBeenCalledTimes(1);
    expect(recordSaleEarnings).toHaveBeenCalledTimes(1);
  });

  it("treats a concurrent duplicate (unique-index E11000) as already processed", async () => {
    const signed = buildSignedXdr();
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      buyerWallet,
      creator: creatorId,
      creatorWallet,
      itemType: "book",
      itemId,
      itemTitle: "Paid Book",
      amount: "15",
      currency: "USDC",
      status: "pending",
      memo: "DNB-BOOK-1234",
      // The "confirmed" save must fail with a duplicate-key error to
      // simulate the race where a concurrent request already wrote the same
      // on-chain hash (the unique index on stellarTxHash is the backstop).
      save: jest.fn(function () {
        if (this.status === "confirmed") {
          const err = new Error("E11000 duplicate key");
          err.code = 11000;
          return Promise.reject(err);
        }
        return Promise.resolve(this);
      }),
    };
    const confirmedTx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      stellarTxHash: signed.hash,
      stellarLedger: 88,
      itemTitle: "Paid Book",
      amount: "15",
    };

    // findOne calls: confirmed-by-hash lookup (null), pending lookup (tx),
    // then the backstop lookup after E11000 (confirmedTx).
    jest
      .spyOn(Transaction, "findOne")
      .mockReturnValueOnce(makeQuery(null))
      .mockReturnValueOnce(makeQuery(tx))
      .mockReturnValueOnce(makeQuery(confirmedTx));

    submitTransaction.mockResolvedValue({
      hash: signed.hash,
      ledger: 88,
      successful: true,
    });
    verifyPaymentOperations.mockResolvedValue({ verified: true });

    const res = await request(mountPaymentApp(buyerId))
      .post("/submit")
      .send({ transactionId: tx._id.toString(), signedXdr: signed.xdr });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      replay: true,
      message: "Payment already processed",
      transaction: { hash: signed.hash },
    });
    // The session was rolled back before any earnings/access were recorded.
    expect(session.abortTransaction).toHaveBeenCalled();
    expect(recordSaleEarnings).not.toHaveBeenCalled();
    expect(grantItemAccess).not.toHaveBeenCalled();
  });
});

describe("paymentLimiter (per-user rate limit on payment routes)", () => {
  let paymentLimiter;

  beforeAll(async () => {
    // Tighten the limit BEFORE security.js is imported so the limiter is
    // constructed with the smaller max.
    process.env.RATE_LIMIT_PAYMENT_MAX = "3";
    const security = await import("../src/middlewares/security.js");
    paymentLimiter = security.paymentLimiter;
  });

  afterAll(() => {
    delete process.env.RATE_LIMIT_PAYMENT_MAX;
  });

  it("returns 429 once a single user exceeds the per-user budget", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { _id: "user-abc" };
      next();
    });
    app.use("/api/stellar/payment", paymentLimiter);
    app.post("/api/stellar/payment/initialize", (req, res) =>
      res.status(200).json({ success: true })
    );

    const statuses = [];
    for (let i = 0; i < 4; i++) {
      const res = await request(app)
        .post("/api/stellar/payment/initialize")
        .send({ itemType: "book", itemId: "x" });
      statuses.push(res.statusCode);
    }

    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});
