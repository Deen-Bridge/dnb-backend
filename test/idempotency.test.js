import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { errorHandler } from "../src/middlewares/errorHandler.js";

jest.setTimeout(60000);

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  resolveAsset: jest.fn(),
  STROOPS_PER_UNIT: 10000000n,
  toStroops: jest.fn(),
  fromStroops: jest.fn(),
  applySlippage: jest.fn(),
  findPaymentPaths: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  calculateFeeSplit: jest.fn().mockReturnValue(null),
  buildSep7Uri: jest.fn().mockReturnValue("web+stellar:pay?mock"),
  isValidPublicKey: jest.fn().mockReturnValue(true),
  getAccountBalance: jest.fn(),
  MEMO_REQUIRED_DATA_KEY: "config.memo_required",
  isMemoRequired: jest.fn(),
  PREFLIGHT_REASON_CODES: {},
  preflightPayment: jest.fn().mockResolvedValue({ ok: true }),
  buildPaymentTransaction: jest.fn().mockResolvedValue({
    xdr: "mock_xdr_string",
    networkPassphrase: "Test SDF Network ; September 2015",
    network: "testnet",
    hash: "mock_hash_12345",
  }),
  buildReversePaymentTransaction: jest.fn(),
  submitTransaction: jest.fn().mockResolvedValue({ hash: "mock_tx_hash_123" }),
  verifyTransaction: jest.fn(),
  verifyPaymentOperations: jest.fn().mockResolvedValue({ ok: true }),
  validateSignedPaymentXdr: jest.fn().mockReturnValue({ valid: true }),
  hasTrustline: jest.fn().mockResolvedValue(true),
  hasUsdcTrustline: jest.fn().mockResolvedValue(true),
  getExplorerUrl: jest.fn((hash) => `https://stellar.expert/tx/${hash}`),
  getAccountExplorerUrl: jest.fn(),
  server: {},
  USDC: "USDC",
  USDC_ISSUER: "",
  NETWORK: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  DONATION_WALLET_PUBLIC_KEY: "GAAZI4TCR3TY5OJHCTJC2A4QSYRZPBTXFDVKT5GLA7IHQMMLVJSSZ26K",
  PLATFORM_FEE_PERCENT: 0,
  PLATFORM_WALLET_PUBLIC_KEY: "",
  DEFAULT_ASSET_CODE: "USDC",
}));

jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  enqueue: jest.fn().mockResolvedValue(undefined),
}));

const User = (await import("../src/models/User.js")).default;
const Book = (await import("../src/models/Book.js")).default;
const Transaction = (await import("../src/models/Transaction.js")).default;
const IdempotencyKey = (await import("../src/models/IdempotencyKey.js")).default;
const protect = (await import("../src/middlewares/authMiddleware.js")).protect;
const idempotencyMiddleware = (await import("../src/middlewares/idempotency.js")).idempotency;
const paymentRoutes = (await import("../src/routes/stellar/paymentRoutes.js")).default;
const donationRoutes = (await import("../src/routes/stellar/donationRoutes.js")).default;
const payoutRoutes = (await import("../src/routes/payoutRoutes.js")).default;

const JWT_SECRET = process.env.JWT_SECRET || "test_secret_key_32_characters_long_for_testing";

describe("Request-Level Idempotency Layer (#93)", () => {
  let mongoServer;
  let user, book, token;
  let app;
  let mockConcurrencyHandler;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    process.env.DONATION_WALLET_PUBLIC_KEY =
      "GAAZI4TCR3TY5OJHCTJC2A4QSYRZPBTXFDVKT5GLA7IHQMMLVJSSZ26K";

    mongoServer = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: "wiredTiger" },
    });
    await mongoose.connect(mongoServer.getUri());

    await User.createCollection();
    await Book.createCollection();
    await Transaction.createCollection();
    await IdempotencyKey.createCollection();
    await IdempotencyKey.syncIndexes();
  });

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await IdempotencyKey.deleteMany({});
    await Transaction.deleteMany({});
    await User.deleteMany({});
    await Book.deleteMany({});

    user = await User.create({
      name: "Test Buyer",
      username: "testbuyer",
      email: "buyer@example.com",
      password: "Password123!",
      role: "student",
      stellarWallet: {
        publicKey: "GAAZI4TCR3TY5OJHCTJC2A4QSYRZPBTXFDVKT5GLA7IHQMMLVJSSZ26K",
      },
    });

    token = jwt.sign({ userId: user._id, role: "student" }, JWT_SECRET, {
      expiresIn: "1h",
    });

    book = await Book.create({
      title: "Test Book for Idempotency",
      author: user._id,
      description: "Test Description for Idempotency Book",
      image: "https://cloudinary.com/test.jpg",
      fileUrl: "https://cloudinary.com/test.pdf",
      price: 10,
      currency: "USDC",
    });

    mockConcurrencyHandler = jest.fn((req, res) => {
      setTimeout(() => res.status(200).json({ success: true, transactionId: "mock_tx_id" }), 30);
    });

    app = express();
    app.use(express.json());
    app.post("/test-concurrency", protect, idempotencyMiddleware({ required: true }), mockConcurrencyHandler);
    app.use("/api/stellar/payment", paymentRoutes);
    app.use("/api/stellar/donation", donationRoutes);
    app.use("/api/payouts", payoutRoutes);
    app.use(errorHandler);
  });

  it("proves the concurrency lock via unique-index insert on concurrent same-key requests", async () => {
    const key = "concurrency-key-12345";
    const payload = {
      itemType: "book",
      itemId: book._id.toString(),
      buyerWallet: user.stellarWallet.publicKey,
    };

    const [res1, res2] = await Promise.all([
      request(app)
        .post("/test-concurrency")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(payload),
      request(app)
        .post("/test-concurrency")
        .set("Authorization", `Bearer ${token}`)
        .set("Idempotency-Key", key)
        .send(payload),
    ]);

    const winnerRes = res1.status === 200 ? res1 : res2;
    const loserRes = res1.status === 409 ? res1 : res2;

    expect(winnerRes.status).toBe(200);
    expect(loserRes.status).toBe(409);
    expect(winnerRes.body.success).toBe(true);
    expect(loserRes.body.message).toMatch(/currently in progress/i);
    expect(mockConcurrencyHandler).toHaveBeenCalledTimes(1);
  });

  it("replays a completed key returning identical status + body without creating second Transaction", async () => {
    const key = "replay-key-99999";
    const payload = {
      itemType: "book",
      itemId: book._id.toString(),
      buyerWallet: user.stellarWallet.publicKey,
    };

    const firstRes = await request(app)
      .post("/api/stellar/payment/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.success).toBe(true);
    const originalTxId = firstRes.body.transactionId;

    const replayRes = await request(app)
      .post("/api/stellar/payment/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body).toEqual(firstRes.body);
    expect(replayRes.body.transactionId).toBe(originalTxId);

    const txCount = await Transaction.countDocuments({ buyer: user._id });
    expect(txCount).toBe(1);
  });

  it("returns 422 Unprocessable Entity when same key arrives with a different body payload", async () => {
    const key = "mismatch-key-55555";
    const payload1 = {
      itemType: "book",
      itemId: book._id.toString(),
      buyerWallet: user.stellarWallet.publicKey,
    };
    const payload2 = {
      itemType: "book",
      itemId: book._id.toString(),
      buyerWallet: "GOTHERWALLET1234567890123456789012345678901234567890",
    };

    const res1 = await request(app)
      .post("/api/stellar/payment/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload1);
    expect(res1.status).toBe(200);

    const res2 = await request(app)
      .post("/api/stellar/payment/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload2);

    expect(res2.status).toBe(422);
    expect(res2.body.message).toMatch(/payload mismatch/i);
  });

  it("allows missing key requests to proceed normally according to policy", async () => {
    const payload = {
      itemType: "book",
      itemId: book._id.toString(),
      buyerWallet: user.stellarWallet.publicKey,
    };

    const res = await request(app)
      .post("/api/stellar/payment/initialize")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("provides idempotency protection to donation routes", async () => {
    const key = "donation-key-77777";
    const payload = {
      amount: "50",
      publicKey: user.stellarWallet.publicKey,
    };

    const firstRes = await request(app)
      .post("/api/stellar/donation/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(firstRes.status).toBe(200);

    const replayRes = await request(app)
      .post("/api/stellar/donation/initialize")
      .set("Authorization", `Bearer ${token}`)
      .set("Idempotency-Key", key)
      .send(payload);

    expect(replayRes.status).toBe(200);
    expect(replayRes.body).toEqual(firstRes.body);

    const txCount = await Transaction.countDocuments({ buyer: user._id });
    expect(txCount).toBe(1);
  });

  it("verifies idempotency keys expire via TTL", async () => {
    const indexes = IdempotencyKey.schema.indexes();
    const ttlIndex = indexes.find(
      (idx) => idx[0].createdAt === 1 && idx[1] && idx[1].expireAfterSeconds === 86400
    );
    expect(ttlIndex).toBeDefined();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });
});

