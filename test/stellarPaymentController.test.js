import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

const buildPaymentTransaction = jest.fn();
const buildSep7Uri = jest.fn();
const calculateFeeSplit = jest.fn();
const preflightPayment = jest.fn();
const submitTransaction = jest.fn();
const verifyPaymentOperations = jest.fn();
const getExplorerUrl = jest.fn((hash) => `https://stellar.expert/tx/${hash}`);
const recordSaleEarnings = jest.fn();
const enqueue = jest.fn();

// Mirrors every named export of stellarService.js, not just the ones this
// suite exercises: other test files (preflightPayment.test.js,
// pathPayments.test.js) statically import the real module, and Jest's ESM
// module linker can resolve those against this mock's identity when both
// run in the same worker - an incomplete mock then fails with "does not
// provide an export named X" for exports this file never even references.
jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  STROOPS_PER_UNIT: 10000000n,
  toStroops: jest.fn(),
  fromStroops: jest.fn(),
  resolveAsset: jest.fn(),
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
  networkPassphrase: "Test SDF Network ; September 2015",
  DONATION_WALLET_PUBLIC_KEY: "",
  PLATFORM_FEE_PERCENT: 0,
  PLATFORM_WALLET_PUBLIC_KEY: "",
}));

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings,
}));

// paymentController.js enqueues background jobs (receipt generation, retry
// verification) via the real job queue - mock it so those calls don't hit
// the actual queue, which has no handlers registered in this suite.
jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  enqueue,
}));

const { initializePayment, submitPayment } = await import(
  "../src/controllers/stellar/paymentController.js"
);
const User = (await import("../src/models/User.js")).default;
const Book = (await import("../src/models/Book.js")).default;
const Course = (await import("../src/models/Course.js")).default;
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

describe("Stellar payment controller", () => {
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

  it("initializes a book payment and returns unsigned XDR details", async () => {
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

    jest.spyOn(User, "findById").mockReturnValue(makeQuery(buyer));
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(null));
    buildPaymentTransaction.mockResolvedValue({
      xdr: "unsigned-xdr",
      hash: "expected-hash",
      networkPassphrase: "Test SDF Network ; September 2015",
      feeSplit: null,
    });
    buildSep7Uri.mockReturnValue("web+stellar:pay?destination=creator");

    const res = await request(mountPaymentApp(buyerId))
      .post("/initialize")
      .send({
        itemType: "book",
        itemId: itemId.toString(),
        buyerWallet,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.payment).toMatchObject({
      xdr: "unsigned-xdr",
      expectedHash: "expected-hash",
    });
    expect(buildPaymentTransaction).toHaveBeenCalledWith(
      expect.objectContaining({
        sourcePublicKey: buyerWallet,
        destinationPublicKey: creatorWallet,
        amount: "15",
        applyPlatformFee: true,
      })
    );
    expect(savedTransactions).toHaveLength(1);
    expect(savedTransactions[0]).toMatchObject({
      buyer: buyerId,
      buyerWallet,
      creator: creatorId,
      creatorWallet,
      status: "pending",
      // #18: the pre-computed hash is stored as expectedHash at init for later
      // XDR validation; stellarTxHash is only set after actual submission.
      expectedHash: "expected-hash",
    });
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it("rejects an invalid signed XDR and stores the Stellar failure reason", async () => {
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      status: "pending",
      save: jest.fn(() => Promise.resolve()),
    };
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    submitTransaction.mockRejectedValue(new Error("Invalid XDR"));

    const res = await request(mountPaymentApp(buyerId))
      .post("/submit")
      .send({
        transactionId: tx._id.toString(),
        signedXdr: "tampered-xdr",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      message: "Transaction failed on Stellar network",
      error: "Invalid XDR",
    });
    expect(tx.status).toBe("failed");
    expect(tx.failureReason).toBe("Invalid XDR");
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it("does not grant access when on-chain verification fails", async () => {
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      itemType: "course",
      itemId,
      itemTitle: "Course",
      amount: "25",
      creatorWallet,
      status: "pending",
      save: jest.fn(() => Promise.resolve()),
    };
    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    const findByIdSpy = jest.spyOn(User, "findById");
    submitTransaction.mockResolvedValue({
      hash: "hash-failed-verification",
      ledger: 44,
      successful: true,
    });
    verifyPaymentOperations.mockResolvedValue({
      verified: false,
      reason: "Missing expected USDC payment",
    });

    const res = await request(mountPaymentApp(buyerId))
      .post("/submit")
      .send({
        transactionId: tx._id.toString(),
        signedXdr: "signed-xdr",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe(
      "Payment could not be verified on the Stellar network"
    );
    expect(tx.status).toBe("failed");
    expect(tx.failureReason).toContain("On-chain verification failed");
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(recordSaleEarnings).not.toHaveBeenCalled();
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
  });

  it("grants course access only after successful Stellar verification", async () => {
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      creator: creatorId,
      itemType: "course",
      itemId,
      itemTitle: "Course",
      amount: "25",
      creatorWallet,
      status: "pending",
      save: jest.fn(() => Promise.resolve()),
    };
    const buyer = {
      _id: buyerId,
      purchasedCourses: [],
      stat: { coursesEnrolled: 0 },
      save: jest.fn(() => Promise.resolve()),
    };

    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(buyer));
    jest
      .spyOn(Course, "findByIdAndUpdate")
      .mockResolvedValue({ _id: itemId });
    submitTransaction.mockResolvedValue({
      hash: "hash-confirmed",
      ledger: 77,
      successful: true,
    });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    recordSaleEarnings.mockResolvedValue({ success: true });

    const res = await request(mountPaymentApp(buyerId))
      .post("/submit")
      .send({
        transactionId: tx._id.toString(),
        signedXdr: "signed-xdr",
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(verifyPaymentOperations).toHaveBeenCalledWith("hash-confirmed", [{ destination: creatorWallet, amount: "25" }], "USDC");
    expect(recordSaleEarnings).toHaveBeenCalledWith(tx, { session });
    expect(buyer.purchasedCourses).toHaveLength(1);
    expect(buyer.purchasedCourses[0].courseId).toBe(itemId);
    expect(buyer.stat.coursesEnrolled).toBe(1);
    expect(Course.findByIdAndUpdate).toHaveBeenCalledWith(
      itemId,
      { $addToSet: { enrolledUsers: buyerId } },
      { session }
    );
    expect(tx.status).toBe("confirmed");
    // Terminal state — the submit confirm path must leave the row without an
    // expiry so the TTL reaper can never delete it.
    expect(tx.expiresAt).toBeUndefined();
    expect(session.commitTransaction).toHaveBeenCalledTimes(1);
    expect(session.abortTransaction).not.toHaveBeenCalled();
  });

  it("aborts the Mongo transaction if granting access fails", async () => {
    const tx = {
      _id: new mongoose.Types.ObjectId(),
      buyer: buyerId,
      creator: creatorId,
      itemType: "book",
      itemId,
      itemTitle: "Book",
      amount: "12",
      creatorWallet,
      status: "pending",
      save: jest.fn(() => Promise.resolve()),
    };
    const buyer = {
      _id: buyerId,
      purchasedBooks: [],
      stat: { booksRead: 0 },
      save: jest.fn(() => Promise.reject(new Error("grant failed"))),
    };

    jest.spyOn(Transaction, "findOne").mockReturnValue(makeQuery(tx));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(buyer));
    submitTransaction.mockResolvedValue({
      hash: "hash-before-access-failure",
      ledger: 88,
      successful: true,
    });
    verifyPaymentOperations.mockResolvedValue({ verified: true });
    recordSaleEarnings.mockResolvedValue({ success: true });

    const res = await request(mountPaymentApp(buyerId))
      .post("/submit")
      .send({
        transactionId: tx._id.toString(),
        signedXdr: "signed-xdr",
      });

    expect(res.statusCode).toBe(500);
    expect(res.body).toMatchObject({
      success: false,
      message: "Failed to process payment",
    });
    expect(recordSaleEarnings).toHaveBeenCalled();
    expect(session.abortTransaction).toHaveBeenCalledTimes(1);
    expect(session.commitTransaction).not.toHaveBeenCalled();
  });
});
