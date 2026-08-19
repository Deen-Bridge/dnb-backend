import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";

const TESTNET_PASSPHRASE = "Test SDF Network ; September 2015";

// ── Mocks ───────────────────────────────────────────────────────────────────
const submitTransaction = jest.fn();
const verifyTransaction = jest.fn();
const getExplorerUrl = jest.fn((hash) => `https://stellar.expert/tx/${hash}`);
const buildCreateClaimableBalanceTx = jest.fn();
const buildClaimTx = jest.fn();
const resolveBalanceId = jest.fn();
const getClaimableBalance = jest.fn();
const validateSignedGiftXdr = jest.fn();
const giftExpiryFromNow = jest.fn(() => new Date(Date.now() + 30 * 24 * 3600 * 1000));
const grantItemAccess = jest.fn();
const recordSaleEarnings = jest.fn();
const enqueue = jest.fn();

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  STROOPS_PER_UNIT: 10000000n,
  toStroops: jest.fn(),
  fromStroops: jest.fn(),
  applySlippage: jest.fn(),
  findPaymentPaths: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  calculateFeeSplit: jest.fn(),
  buildSep7Uri: jest.fn(),
  isValidPublicKey: jest.fn(),
  getAccountBalance: jest.fn(),
  MEMO_REQUIRED_DATA_KEY: "config.memo_required",
  isMemoRequired: jest.fn(),
  PREFLIGHT_REASON_CODES: {},
  preflightPayment: jest.fn(),
  buildPaymentTransaction: jest.fn(),
  buildReversePaymentTransaction: jest.fn(),
  submitTransaction,
  verifyTransaction,
  verifyPaymentOperations: jest.fn(),
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

jest.unstable_mockModule("../src/services/stellar/claimableBalanceService.js", () => ({
  buildCreateClaimableBalanceTx,
  buildClaimTx,
  resolveBalanceId,
  getClaimableBalance,
  validateSignedGiftXdr,
  giftExpiryFromNow,
}));

jest.unstable_mockModule("../src/services/stellar/reconciliationService.js", () => ({
  grantItemAccess,
}));

jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings,
}));

jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  enqueue,
}));

const {
  initializeGift,
  submitGift,
  listGifts,
  getGift,
  claimInitialize,
  claimSubmit,
} = await import("../src/controllers/stellar/giftController.js");
const { initializePayment } = await import(
  "../src/controllers/stellar/paymentController.js"
);
const User = (await import("../src/models/User.js")).default;
const Book = (await import("../src/models/Book.js")).default;
const Course = (await import("../src/models/Course.js")).default;
const GiftClaim = (await import("../src/models/GiftClaim.js")).default;
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

const mountGiftApp = (userId) => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { _id: userId };
    next();
  });
  app.post("/initialize", initializeGift);
  app.post("/submit", submitGift);
  app.get("/", listGifts);
  app.get("/:id", getGift);
  app.post("/:id/claim/initialize", claimInitialize);
  app.post("/:id/claim/submit", claimSubmit);
  return app;
};

const senderWallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const recipientWallet = "GCKFBEIYTKPXL5UIRZ5OO3KSOFDP5D4R6YGNFWEQSIFGKWO3EZ5F3TGI";
const BALANCE_ID = "00000000" + "ab".repeat(32);

describe("Gift controller (claimable balances)", () => {
  let senderId;
  let recipientId;
  let creatorId;
  let itemId;
  let savedGifts;

  beforeEach(() => {
    jest.restoreAllMocks();
    submitTransaction.mockReset();
    verifyTransaction.mockReset();
    getExplorerUrl.mockClear();
    buildCreateClaimableBalanceTx.mockReset();
    buildClaimTx.mockReset();
    resolveBalanceId.mockReset();
    getClaimableBalance.mockReset();
    validateSignedGiftXdr.mockReset();
    giftExpiryFromNow.mockClear();
    grantItemAccess.mockReset().mockResolvedValue(undefined);
    recordSaleEarnings.mockReset();
    enqueue.mockReset().mockResolvedValue(undefined);

    senderId = new mongoose.Types.ObjectId();
    recipientId = new mongoose.Types.ObjectId();
    creatorId = new mongoose.Types.ObjectId();
    itemId = new mongoose.Types.ObjectId();
    savedGifts = [];

    jest.spyOn(GiftClaim.prototype, "save").mockImplementation(function () {
      savedGifts.push(this);
      return Promise.resolve(this);
    });
    jest.spyOn(GiftClaim, "updateMany").mockResolvedValue({ modifiedCount: 0 });
    jest.spyOn(Transaction.prototype, "save").mockImplementation(function () {
      return Promise.resolve(this);
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("initializes a gift and persists a pending_signature GiftClaim", async () => {
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };
    const recipient = { _id: recipientId, name: "Recipient", stellarWallet: { publicKey: recipientWallet }, purchasedBooks: [] };
    const creator = { _id: creatorId, name: "Educator", stellarWallet: { publicKey: recipientWallet } };
    const book = { _id: itemId, title: "Paid Book", price: 15, author: creator };

    jest.spyOn(User, "findById").mockImplementation((id) => {
      if (String(id) === senderId.toString()) return makeQuery(sender);
      if (String(id) === recipientId.toString()) return makeQuery(recipient);
      return makeQuery(null);
    });
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));
    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(null));
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    giftExpiryFromNow.mockReturnValue(expiresAt);
    buildCreateClaimableBalanceTx.mockResolvedValue({
      xdr: "unsigned-gift-xdr",
      hash: "expected-gift-hash",
      networkPassphrase: TESTNET_PASSPHRASE,
      expiresAt,
    });

    const res = await request(mountGiftApp(senderId))
      .post("/initialize")
      .send({ itemType: "book", itemId: itemId.toString(), recipientUserId: recipientId.toString() });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      payment: { xdr: "unsigned-gift-xdr", expectedHash: "expected-gift-hash" },
    });
    expect(savedGifts).toHaveLength(1);
    expect(savedGifts[0]).toMatchObject({
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      creator: creatorId,
      itemType: "book",
      itemId,
      amount: "15",
      status: "pending_signature",
      createTxHash: "expected-gift-hash",
    });
    expect(savedGifts[0].balanceId).toBeUndefined();
  });

  it.each([
    {
      name: "recipient with no wallet",
      recipient: () => ({ _id: recipientId, name: "Recipient", purchasedBooks: [] }),
      expected: "Recipient has not connected their Stellar wallet yet",
    },
    {
      name: "self-gift",
      selfGift: true,
      expected: "You cannot gift an item to yourself",
    },
  ])("rejects $name", async ({ recipient, expected, selfGift }) => {
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };
    const creator = { _id: creatorId, name: "Educator", stellarWallet: { publicKey: recipientWallet } };
    const book = { _id: itemId, title: "Paid Book", price: 15, author: creator };

    jest.spyOn(User, "findById").mockImplementation((id) => {
      if (String(id) === senderId.toString()) return makeQuery(sender);
      if (String(id) === recipientId.toString()) return makeQuery(recipient());
      return makeQuery(null);
    });
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));

    const res = await request(mountGiftApp(senderId))
      .post("/initialize")
      .send({
        itemType: "book",
        itemId: itemId.toString(),
        recipientUserId: selfGift ? senderId.toString() : recipientId.toString(),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe(expected);
    expect(savedGifts).toHaveLength(0);
  });

  it("rejects gifting an item the recipient already owns", async () => {
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };
    const recipient = {
      _id: recipientId,
      name: "Recipient",
      stellarWallet: { publicKey: recipientWallet },
      purchasedBooks: [{ bookId: itemId }],
    };
    const creator = { _id: creatorId, name: "Educator", stellarWallet: { publicKey: recipientWallet } };
    const book = { _id: itemId, title: "Paid Book", price: 15, author: creator };

    jest.spyOn(User, "findById").mockImplementation((id) => {
      if (String(id) === senderId.toString()) return makeQuery(sender);
      if (String(id) === recipientId.toString()) return makeQuery(recipient);
      return makeQuery(null);
    });
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));

    const res = await request(mountGiftApp(senderId))
      .post("/initialize")
      .send({
        itemType: "book",
        itemId: itemId.toString(),
        recipientUserId: recipientId.toString(),
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Recipient already owns this book");
    expect(savedGifts).toHaveLength(0);
  });

  it("rejects a duplicate pending gift for the same recipient+item", async () => {
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };
    const recipient = { _id: recipientId, name: "Recipient", stellarWallet: { publicKey: recipientWallet }, purchasedBooks: [] };
    const creator = { _id: creatorId, name: "Educator", stellarWallet: { publicKey: recipientWallet } };
    const book = { _id: itemId, title: "Paid Book", price: 15, author: creator };
    const existing = { _id: new mongoose.Types.ObjectId() };

    jest.spyOn(User, "findById").mockImplementation((id) => {
      if (String(id) === senderId.toString()) return makeQuery(sender);
      if (String(id) === recipientId.toString()) return makeQuery(recipient);
      return makeQuery(null);
    });
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));
    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(existing));

    const res = await request(mountGiftApp(senderId))
      .post("/initialize")
      .send({ itemType: "book", itemId: itemId.toString(), recipientUserId: recipientId.toString() });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toContain("pending gift");
    expect(res.body.giftId).toBe(existing._id.toString());
  });

  it("submits a gift, stores the REAL balance id (≠ tx hash), and sets status open", async () => {
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      itemType: "book",
      itemId,
      amount: "15",
      assetCode: "USDC",
      status: "pending_signature",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      save: jest.fn(function () { return Promise.resolve(this); }),
    };
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };

    jest.spyOn(User, "findById").mockReturnValue(makeQuery(sender));
    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    submitTransaction.mockResolvedValue({ hash: "create-tx-hash", ledger: 5, successful: true });
    resolveBalanceId.mockResolvedValue(BALANCE_ID);

    const res = await request(mountGiftApp(senderId))
      .post("/submit")
      .send({ giftId: gift._id.toString(), signedXdr: "signed-xdr" });

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ success: true, balanceId: BALANCE_ID, createTxHash: "create-tx-hash" });
    expect(gift.status).toBe("open");
    expect(gift.balanceId).toBe(BALANCE_ID);
    expect(gift.balanceId).not.toBe("create-tx-hash");
    expect(validateSignedGiftXdr).toHaveBeenCalled();
  });

  it("rejects a tampered signed XDR before any DB write", async () => {
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      itemType: "book",
      itemId,
      amount: "15",
      assetCode: "USDC",
      status: "pending_signature",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      save: jest.fn(),
    };
    const sender = { _id: senderId, stellarWallet: { publicKey: senderWallet } };

    jest.spyOn(User, "findById").mockReturnValue(makeQuery(sender));
    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    validateSignedGiftXdr.mockImplementation(() => {
      throw new Error("Signed XDR missing the recipient claimant with before_absolute_time(expiresAt)");
    });

    const res = await request(mountGiftApp(senderId))
      .post("/submit")
      .send({ giftId: gift._id.toString(), signedXdr: "tampered-xdr" });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBe("Signed transaction does not match expected gift details");
    expect(submitTransaction).not.toHaveBeenCalled();
    expect(gift.status).toBe("pending_signature");
  });

  it("builds a claim XDR for the recipient before expiry (trustline-free)", async () => {
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      balanceId: BALANCE_ID,
      itemType: "book",
      itemId,
      status: "open",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    };
    const user = { _id: recipientId, stellarWallet: { publicKey: recipientWallet } };

    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(user));
    buildClaimTx.mockResolvedValue({
      xdr: "claim-xdr",
      hash: "claim-hash",
      networkPassphrase: TESTNET_PASSPHRASE,
      includesChangeTrust: true,
    });

    const res = await request(mountGiftApp(recipientId))
      .post(`/${gift._id.toString()}/claim/initialize`)
      .send({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      action: "claim",
      claim: { xdr: "claim-xdr", includesChangeTrust: true },
    });
  });

  it.each([
    { name: "sender before expiry", userId: () => "SENDER", expected: 403 },
    { name: "recipient after expiry", userId: () => "RECIPIENT", expiresPast: true, expected: 403 },
    { name: "stranger", userId: () => "STRANGER", expected: 403 },
  ])("authorizes claim: $name", async ({ userId, expected, expiresPast }) => {
    const ids = { SENDER: senderId, RECIPIENT: recipientId, STRANGER: new mongoose.Types.ObjectId() };
    const actualId = ids[userId()];
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      balanceId: BALANCE_ID,
      itemType: "book",
      itemId,
      status: "open",
      expiresAt: new Date(Date.now() + (expiresPast ? -1 : 1) * 3600 * 1000),
      save: jest.fn(function () { return Promise.resolve(this); }),
    };
    const user = { _id: actualId, stellarWallet: { publicKey: senderWallet } };

    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(user));

    const res = await request(mountGiftApp(actualId))
      .post(`/${gift._id.toString()}/claim/initialize`)
      .send({});

    expect(res.statusCode).toBe(expected);
    expect(buildClaimTx).not.toHaveBeenCalled();
  });

  it("grants access to the RECIPIENT (never the sender) on a successful claim", async () => {
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      balanceId: BALANCE_ID,
      itemType: "course",
      itemId,
      status: "open",
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      save: jest.fn(function () { return Promise.resolve(this); }),
    };
    const user = { _id: recipientId, stellarWallet: { publicKey: recipientWallet } };

    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(user));
    submitTransaction.mockResolvedValue({ hash: "claim-tx-hash", ledger: 9, successful: true });
    verifyTransaction.mockResolvedValue({
      exists: true,
      successful: true,
      operations: [{ type: "claim_claimable_balance", balance_id: BALANCE_ID }],
    });

    const res = await request(mountGiftApp(recipientId))
      .post(`/${gift._id.toString()}/claim/submit`)
      .send({ signedXdr: "signed-claim-xdr" });

    expect(res.statusCode).toBe(200);
    expect(res.body.action).toBe("claimed");
    expect(gift.status).toBe("claimed");
    expect(gift.claimTxHash).toBe("claim-tx-hash");
    // Access lands on the RECIPIENT, not the sender.
    expect(grantItemAccess).toHaveBeenCalledWith({
      buyerId: recipientId,
      itemType: "course",
      itemId,
    });
    expect(grantItemAccess.mock.calls[0][0].buyerId).not.toBe(senderId);
  });

  it("lets the sender reclaim after expiry without granting access", async () => {
    const gift = {
      _id: new mongoose.Types.ObjectId(),
      sender: senderId,
      recipient: recipientId,
      recipientWallet,
      balanceId: BALANCE_ID,
      itemType: "book",
      itemId,
      status: "expired",
      expiresAt: new Date(Date.now() - 3600 * 1000),
      save: jest.fn(function () { return Promise.resolve(this); }),
    };
    const user = { _id: senderId, stellarWallet: { publicKey: senderWallet } };

    jest.spyOn(GiftClaim, "findOne").mockReturnValue(makeQuery(gift));
    jest.spyOn(User, "findById").mockReturnValue(makeQuery(user));
    submitTransaction.mockResolvedValue({ hash: "reclaim-tx-hash", ledger: 10, successful: true });
    verifyTransaction.mockResolvedValue({
      exists: true,
      successful: true,
      operations: [{ type: "claim_claimable_balance", balance_id: BALANCE_ID }],
    });

    const res = await request(mountGiftApp(senderId))
      .post(`/${gift._id.toString()}/claim/submit`)
      .send({ signedXdr: "signed-reclaim-xdr" });

    expect(res.statusCode).toBe(200);
    expect(res.body.action).toBe("reclaimed");
    expect(gift.status).toBe("reclaimed");
    expect(grantItemAccess).not.toHaveBeenCalled();
  });
});

describe("purchase-flow fallback to claimable balance", () => {
  const buyerId = new mongoose.Types.ObjectId();
  const itemId = new mongoose.Types.ObjectId();
  const buyerWallet = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

  const mountPaymentApp = () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { _id: buyerId };
      next();
    });
    app.post("/initialize", initializePayment);
    return app;
  };

  const makeSession = () => ({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(() => Promise.resolve()),
    abortTransaction: jest.fn(() => Promise.resolve()),
    endSession: jest.fn(),
  });

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.spyOn(mongoose, "startSession").mockResolvedValue(makeSession());
  });

  it("returns { fallback: 'claimable_balance' } when the creator has no wallet", async () => {
    const buyer = { _id: buyerId, stellarWallet: { publicKey: buyerWallet } };
    // creator has no stellarWallet and PLATFORM_COLLECT_ENABLED is off
    const book = { _id: itemId, title: "Book", price: 15, author: { _id: new mongoose.Types.ObjectId(), name: "Creator" } };

    jest.spyOn(User, "findById").mockReturnValue(makeQuery(buyer));
    jest.spyOn(Book, "findById").mockReturnValue(makeQuery(book));

    const res = await request(mountPaymentApp())
      .post("/initialize")
      .send({ itemType: "book", itemId: itemId.toString(), buyerWallet });

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({
      success: false,
      fallback: "claimable_balance",
      message: "Creator has not connected their Stellar wallet yet",
    });
  });
});
