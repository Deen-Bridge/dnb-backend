// test/webhooks.test.js
//
// Offline (mocked-axios) suite for the outbound signed webhook system (#45).
// Every acceptance criterion is exercised: HMAC signing/verification, delivery
// row fan-out, backoff → dead-letter → redelivery, atomic claim (no double
// send), auto-disable, ping, transaction-commit-safe emission, the payload
// allowlist, and the admin-gated management API. No outbound network is used —
// the delivery worker's HTTP client is injected.

// Worker constants are read from env at module load, so tune them BEFORE the
// dynamic import of deliveryWorker below.
process.env.WEBHOOK_MAX_ATTEMPTS = "3";
process.env.WEBHOOK_BACKOFF_JITTER_MS = "0";
process.env.WEBHOOK_AUTO_DISABLE_THRESHOLD = "2";

import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryReplSet } from "mongodb-memory-server";

// ── Mocks for the payment controller's Stellar dependencies ─────────────────
// Full surface so the ESM linker can bind every named import in
// paymentController.js even though this suite only drives submitPayment.
const submitTransaction = jest.fn();
const verifyPaymentOperations = jest.fn();
const validateSignedPaymentXdr = jest.fn();
const getExplorerUrl = jest.fn((h) => `https://stellar.expert/tx/${h}`);
const recordSaleEarnings = jest.fn();
const grantItemAccess = jest.fn();
const enqueue = jest.fn();

jest.unstable_mockModule("../src/services/stellar/stellarService.js", () => ({
  buildPaymentTransaction: jest.fn(),
  buildPathPaymentTransaction: jest.fn(),
  buildSep7Uri: jest.fn(),
  calculateFeeSplit: jest.fn(() => null),
  preflightPayment: jest.fn(),
  submitTransaction,
  verifyTransaction: jest.fn(),
  verifyPaymentOperations,
  validateSignedPaymentXdr,
  findPaymentPaths: jest.fn(),
  applySlippage: jest.fn(),
  NETWORK: "testnet",
  networkPassphrase: "Test SDF Network ; September 2015",
  getExplorerUrl,
  USDC: "USDC",
  PLATFORM_WALLET_PUBLIC_KEY: "",
}));
jest.unstable_mockModule("../src/services/payoutService.js", () => ({
  recordSaleEarnings,
}));
jest.unstable_mockModule("../src/services/stellar/reconciliationService.js", () => ({
  grantItemAccess,
}));
jest.unstable_mockModule("../src/jobs/queue.js", () => ({
  enqueue,
}));

// ── Dynamic imports (after env tuning + mock registration) ──────────────────
const WebhookEndpoint = (await import("../src/models/WebhookEndpoint.js")).default;
const WebhookDelivery = (await import("../src/models/WebhookDelivery.js")).default;
const User = (await import("../src/models/User.js")).default;
const Transaction = (await import("../src/models/Transaction.js")).default;

const { signPayload, verifySignature, WEBHOOK_HEADERS } = await import(
  "../src/services/webhooks/signing.js"
);
const { generateSecret, encryptSecret } = await import(
  "../src/services/webhooks/webhookSecret.js"
);
const { emitEvent, buildEventEnvelope, sanitizeEventData, EVENT_TYPES } =
  await import("../src/services/webhooks/webhookService.js");
const { validateWebhookUrl, isPrivateAddress } = await import(
  "../src/services/webhooks/urlGuard.js"
);
const worker = await import("../src/services/webhooks/deliveryWorker.js");
const { submitPayment } = await import(
  "../src/controllers/stellar/paymentController.js"
);
const webhookRoutes = (await import("../src/routes/webhookRoutes.js")).default;
const { errorHandler } = await import("../src/middlewares/errorHandler.js");

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  await mongoose.connect(mongoServer.getUri());
}, 60000);

afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all([
    WebhookEndpoint.deleteMany({}),
    WebhookDelivery.deleteMany({}),
    User.deleteMany({}),
    Transaction.deleteMany({}),
  ]);
  jest.clearAllMocks();
});

// ── Helpers ─────────────────────────────────────────────────────────────────
const KNOWN_SECRET = "test-secret-abcdef0123456789";

const createEndpointDoc = async (overrides = {}) => {
  const owner = overrides.owner || new mongoose.Types.ObjectId();
  return WebhookEndpoint.create({
    url: "https://example.com/hook",
    secretEncrypted: encryptSecret(overrides.secret || KNOWN_SECRET),
    events: ["*"],
    owner,
    ...overrides,
    secret: undefined,
  });
};

const captureClient = () => {
  const calls = [];
  const post = async (url, body, headers) => {
    calls.push({ url, body, headers });
    return { status: 200 };
  };
  return { post, calls };
};

// The controllers emit fire-and-forget (non-blocking), so delivery rows are
// inserted asynchronously after the handler responds. Poll for them to settle.
const waitForDeliveries = async (filter, count, timeout = 3000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if ((await WebhookDelivery.countDocuments(filter)) >= count) return;
    await new Promise((r) => setTimeout(r, 25));
  }
};

// ────────────────────────────────────────────────────────────────────────────
describe("HMAC signing", () => {
  it("generates a v1= signature that verifies against the documented scheme", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ hello: "world" });
    const header = signPayload({ secret: KNOWN_SECRET, timestamp, rawBody });

    expect(header.startsWith("v1=")).toBe(true);
    // Independently recompute the HMAC the way a consumer would.
    const expected =
      "v1=" +
      crypto
        .createHmac("sha256", KNOWN_SECRET)
        .update(`${timestamp}.${rawBody}`)
        .digest("hex");
    expect(header).toBe(expected);
    expect(
      verifySignature({ secret: KNOWN_SECRET, timestamp, rawBody, signatureHeader: header })
    ).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = JSON.stringify({ amount: "10.00" });
    const header = signPayload({ secret: KNOWN_SECRET, timestamp, rawBody });
    const tampered = JSON.stringify({ amount: "9999.00" });
    expect(
      verifySignature({ secret: KNOWN_SECRET, timestamp, rawBody: tampered, signatureHeader: header })
    ).toBe(false);
  });

  it("rejects a stale timestamp (> 5 min)", () => {
    const stale = (Math.floor(Date.now() / 1000) - 600).toString();
    const rawBody = "{}";
    const header = signPayload({ secret: KNOWN_SECRET, timestamp: stale, rawBody });
    expect(
      verifySignature({ secret: KNOWN_SECRET, timestamp: stale, rawBody, signatureHeader: header })
    ).toBe(false);
  });

  it("rejects a wrong secret", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const rawBody = "{}";
    const header = signPayload({ secret: KNOWN_SECRET, timestamp, rawBody });
    expect(
      verifySignature({ secret: "other", timestamp, rawBody, signatureHeader: header })
    ).toBe(false);
  });
});

describe("Backoff schedule", () => {
  it("follows 1m/5m/30m/2h/12h with zero jitter and caps at the last entry", () => {
    expect(worker.computeBackoffMs(1)).toBe(60_000);
    expect(worker.computeBackoffMs(2)).toBe(5 * 60_000);
    expect(worker.computeBackoffMs(3)).toBe(30 * 60_000);
    expect(worker.computeBackoffMs(4)).toBe(2 * 60 * 60_000);
    expect(worker.computeBackoffMs(5)).toBe(12 * 60 * 60_000);
    // Beyond the schedule length it stays at the max.
    expect(worker.computeBackoffMs(9)).toBe(12 * 60 * 60_000);
  });
});

describe("Payload allowlist", () => {
  it("strips non-allowlisted fields (emails, secrets, user docs)", () => {
    const data = sanitizeEventData({
      transactionId: "tx1",
      amount: "10.00",
      email: "leak@example.com",
      password: "hunter2",
      user: { name: "x", passwordHash: "y" },
    });
    expect(data).toEqual({ transactionId: "tx1", amount: "10.00" });
    expect(data.email).toBeUndefined();
    expect(data.password).toBeUndefined();
  });

  it("envelope carries eventId/type/createdAt/apiVersion and sanitized data", () => {
    const env = buildEventEnvelope(EVENT_TYPES.PAYMENT_CONFIRMED, {
      transactionId: "tx2",
      email: "nope@example.com",
    });
    expect(env.eventId).toEqual(expect.any(String));
    expect(env.type).toBe("payment.confirmed");
    expect(env.createdAt).toEqual(expect.any(String));
    expect(env.apiVersion).toEqual(expect.any(String));
    expect(env.data).toEqual({ transactionId: "tx2" });
  });
});

describe("SSRF url guard", () => {
  it("classifies private/loopback/link-local addresses", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.9")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
    expect(isPrivateAddress("169.254.1.1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("rejects non-https and private literal targets at registration", () => {
    expect(() => validateWebhookUrl("http://example.com/x")).toThrow();
    expect(() => validateWebhookUrl("https://127.0.0.1/x")).toThrow();
    expect(() => validateWebhookUrl("https://localhost/x")).toThrow();
    expect(() => validateWebhookUrl("https://10.0.0.1/x")).toThrow();
    // A public https target is accepted.
    expect(validateWebhookUrl("https://hooks.example.com/x")).toBeInstanceOf(URL);
  });
});

describe("emitEvent fan-out", () => {
  it("creates one pending delivery per subscribed active endpoint", async () => {
    const owner = new mongoose.Types.ObjectId();
    const subscribed = await createEndpointDoc({ owner, events: ["payment.confirmed"] });
    const wildcard = await createEndpointDoc({ owner, events: ["*"] });
    await createEndpointDoc({ owner, events: ["course.enrolled"] }); // not matching
    await createEndpointDoc({ owner, events: ["*"], isActive: false }); // inactive

    const { deliveries } = await emitEvent(EVENT_TYPES.PAYMENT_CONFIRMED, {
      transactionId: "tx1",
      email: "leak@example.com",
    });

    expect(deliveries).toBe(2);
    const rows = await WebhookDelivery.find({}).sort({ endpoint: 1 });
    expect(rows).toHaveLength(2);
    const endpointIds = rows.map((r) => r.endpoint.toString()).sort();
    expect(endpointIds).toEqual([subscribed._id.toString(), wildcard._id.toString()].sort());
    for (const row of rows) {
      expect(row.status).toBe("pending");
      expect(row.eventType).toBe("payment.confirmed");
      expect(row.payload.data.email).toBeUndefined();
      expect(row.payload.data.transactionId).toBe("tx1");
    }
  });

  it("returns without throwing when no endpoints match", async () => {
    const res = await emitEvent(EVENT_TYPES.WALLET_CONNECTED, { userId: "u1" });
    expect(res.deliveries).toBe(0);
  });
});

describe("Delivery worker: signing over the wire", () => {
  it("POSTs a signed body whose HMAC verifies, then marks delivered", async () => {
    await createEndpointDoc({ events: ["*"], secret: KNOWN_SECRET });
    await emitEvent(EVENT_TYPES.PAYMENT_CONFIRMED, { transactionId: "tx1", amount: "5.00" });

    const client = captureClient();
    const now = new Date();
    const delivery = await worker.processOne({ post: client.post, now });

    expect(delivery.status).toBe("delivered");
    expect(client.calls).toHaveLength(1);
    const { body, headers } = client.calls[0];
    expect(headers[WEBHOOK_HEADERS.EVENT]).toBe("payment.confirmed");
    expect(headers[WEBHOOK_HEADERS.EVENT_ID]).toEqual(expect.any(String));

    // Verify exactly the bytes that were sent, using the known plaintext secret.
    const ok = verifySignature({
      secret: KNOWN_SECRET,
      timestamp: headers[WEBHOOK_HEADERS.TIMESTAMP],
      rawBody: body,
      signatureHeader: headers[WEBHOOK_HEADERS.SIGNATURE],
    });
    expect(ok).toBe(true);
  });
});

describe("Delivery worker: retry → dead-letter → redeliver", () => {
  const post500 = async () => ({ status: 500 });

  it("retries on the backoff schedule then dead-letters after max attempts", async () => {
    await createEndpointDoc({ events: ["*"] });
    await emitEvent(EVENT_TYPES.PAYMENT_FAILED, { transactionId: "tx1" });

    const t0 = new Date();
    // Attempt 1 → retrying, nextAttemptAt = t0 + 1m
    let d = await worker.processOne({ post: post500, now: t0 });
    expect(d.status).toBe("retrying");
    expect(d.attemptCount).toBe(1);
    expect(d.nextAttemptAt.getTime()).toBe(t0.getTime() + 60_000);

    // Attempt 2 → retrying, nextAttemptAt = t1 + 5m
    const t1 = new Date(t0.getTime() + 60_000);
    d = await worker.processOne({ post: post500, now: t1 });
    expect(d.status).toBe("retrying");
    expect(d.attemptCount).toBe(2);
    expect(d.nextAttemptAt.getTime()).toBe(t1.getTime() + 5 * 60_000);

    // Attempt 3 → dead (MAX_ATTEMPTS=3 for this suite)
    const t2 = new Date(t1.getTime() + 5 * 60_000);
    d = await worker.processOne({ post: post500, now: t2 });
    expect(d.status).toBe("dead");
    expect(d.attemptCount).toBe(3);
    expect(d.attempts.length).toBe(3);
  });

  it("a dead delivery can be redelivered and then succeeds", async () => {
    await createEndpointDoc({ events: ["*"], secret: KNOWN_SECRET });
    await emitEvent(EVENT_TYPES.PAYMENT_FAILED, { transactionId: "tx1" });

    // Drive to dead.
    let now = new Date();
    for (let i = 0; i < 5; i++) {
      const cur = await WebhookDelivery.findOne({});
      if (cur.status === "dead") break;
      now = new Date(now.getTime() + 13 * 60 * 60 * 1000);
      await worker.processOne({ post: post500, now });
    }
    let d = await WebhookDelivery.findOne({});
    expect(d.status).toBe("dead");

    // Redeliver: dead → pending, nextAttemptAt = now.
    d.status = "pending";
    d.nextAttemptAt = new Date();
    await d.save();

    const client = captureClient();
    const redelivered = await worker.processOne({ post: client.post, now: new Date() });
    expect(redelivered.status).toBe("delivered");
    expect(client.calls).toHaveLength(1);
  });
});

describe("Delivery worker: atomic claim", () => {
  it("two concurrent claims never grab the same row (exactly one send)", async () => {
    await createEndpointDoc({ events: ["*"] });
    await emitEvent(EVENT_TYPES.PING, { message: "ping" });

    const now = new Date();
    const [a, b] = await Promise.all([
      worker.claimNextDelivery(now),
      worker.claimNextDelivery(now),
    ]);

    const claimed = [a, b].filter(Boolean);
    expect(claimed).toHaveLength(1);
  });

  it("runDueDeliveries sends each due row exactly once", async () => {
    const owner = new mongoose.Types.ObjectId();
    await createEndpointDoc({ owner, events: ["*"] });
    await createEndpointDoc({ owner, events: ["*"] });
    await emitEvent(EVENT_TYPES.PAYMENT_CONFIRMED, { transactionId: "tx1" });

    const client = captureClient();
    const processed = await worker.runDueDeliveries({ post: client.post, now: new Date() });
    expect(processed).toBe(2);
    expect(client.calls).toHaveLength(2);
  });
});

describe("Delivery worker: auto-disable after sustained failures", () => {
  const post500 = async () => ({ status: 500 });

  it("disables the endpoint after the consecutive-dead threshold", async () => {
    const endpoint = await createEndpointDoc({ events: ["*"] });

    const driveOneToDead = async () => {
      let now = new Date();
      for (let i = 0; i < 5; i++) {
        const d = await WebhookDelivery.findOne({ status: { $in: ["pending", "retrying"] } });
        if (!d) break;
        now = new Date(now.getTime() + 13 * 60 * 60 * 1000);
        await worker.processOne({ post: post500, now });
      }
    };

    // Threshold is 2 for this suite: two dead deliveries → disabled.
    await emitEvent(EVENT_TYPES.PAYMENT_FAILED, { transactionId: "tx1" });
    await driveOneToDead();
    let ep = await WebhookEndpoint.findById(endpoint._id);
    expect(ep.isActive).toBe(true);
    expect(ep.consecutiveFailures).toBe(1);

    await emitEvent(EVENT_TYPES.PAYMENT_FAILED, { transactionId: "tx2" });
    await driveOneToDead();
    ep = await WebhookEndpoint.findById(endpoint._id);
    expect(ep.isActive).toBe(false);
    expect(ep.consecutiveFailures).toBeGreaterThanOrEqual(2);
    expect(ep.disabledReason).toMatch(/consecutive/i);
  });
});

// ── submitPayment emitter wiring + commit-safe emission ─────────────────────
const makeRes = () => {
  const res = { statusCode: 200 };
  res.status = (c) => {
    res.statusCode = c;
    return res;
  };
  res.json = (b) => {
    res.body = b;
    return res;
  };
  return res;
};

const makePendingTransaction = async (buyerId) =>
  Transaction.create({
    buyer: buyerId,
    buyerWallet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    creator: new mongoose.Types.ObjectId(),
    creatorWallet: "GCKFBEIYTKPXL5UIRZ5OO3KSOFDP5D4R6YGNFWEQSIFGKWO3EZ5F3TGI",
    itemType: "course",
    itemId: new mongoose.Types.ObjectId(),
    itemTypeModel: "Course",
    itemTitle: "Intro to Tajweed",
    amount: "10.00",
    currency: "USDC",
    network: "testnet",
    status: "pending",
  });

describe("submitPayment emitter wiring", () => {
  it("emits payment.confirmed after the txn commits, without blocking the response", async () => {
    await createEndpointDoc({ events: ["payment.confirmed"] });
    const buyerId = new mongoose.Types.ObjectId();
    const tx = await makePendingTransaction(buyerId);

    validateSignedPaymentXdr.mockReturnValue(true);
    submitTransaction.mockResolvedValue({ hash: "STELLARHASH", ledger: 999 });
    verifyPaymentOperations.mockResolvedValue({ verified: true });

    const req = {
      user: { _id: buyerId },
      body: { transactionId: tx._id.toString(), signedXdr: "AAAA" },
      ip: "127.0.0.1",
      headers: {},
      id: "req-1",
    };
    const res = makeRes();
    await submitPayment(req, res);

    expect(res.statusCode).toBe(200);
    await waitForDeliveries({ eventType: "payment.confirmed" }, 1);
    const rows = await WebhookDelivery.find({ eventType: "payment.confirmed" });
    expect(rows).toHaveLength(1);
    expect(rows[0].payload.data.transactionId).toBe(tx._id.toString());
    expect(rows[0].payload.data.stellarTxHash).toBe("STELLARHASH");
    expect(rows[0].status).toBe("pending");
  });

  it("emits nothing when the txn is rolled back (unknown transaction → 404)", async () => {
    await createEndpointDoc({ events: ["*"] });
    const req = {
      user: { _id: new mongoose.Types.ObjectId() },
      body: { transactionId: new mongoose.Types.ObjectId().toString(), signedXdr: "AAAA" },
      ip: "127.0.0.1",
      headers: {},
      id: "req-2",
    };
    const res = makeRes();
    await submitPayment(req, res);

    expect(res.statusCode).toBe(404);
    // Give any (erroneous) fire-and-forget emit a chance to land, then confirm none did.
    await new Promise((r) => setTimeout(r, 150));
    expect(await WebhookDelivery.countDocuments({})).toBe(0);
  });

  it("does not block the payment path when the endpoint is unreachable", async () => {
    await createEndpointDoc({ events: ["*"], url: "https://unreachable.example.com/hook" });
    const buyerId = new mongoose.Types.ObjectId();
    const tx = await makePendingTransaction(buyerId);

    validateSignedPaymentXdr.mockReturnValue(true);
    submitTransaction.mockResolvedValue({ hash: "HASH2", ledger: 1000 });
    verifyPaymentOperations.mockResolvedValue({ verified: true });

    const req = {
      user: { _id: buyerId },
      body: { transactionId: tx._id.toString(), signedXdr: "AAAA" },
      ip: "127.0.0.1",
      headers: {},
      id: "req-3",
    };
    const res = makeRes();
    const start = Date.now();
    await submitPayment(req, res);
    // The request completes promptly — delivery happens out of band.
    expect(Date.now() - start).toBeLessThan(5000);
    expect(res.statusCode).toBe(200);
    await waitForDeliveries({}, 1);
    const rows = await WebhookDelivery.find({});
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("pending");
  });
});

// ── Management API (admin-gated), driven through the real router ────────────
const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhookRoutes);
  app.use(errorHandler);
  return app;
};

const makeUser = async (role) =>
  User.create({
    name: `${role} user`,
    email: `${role}_${new mongoose.Types.ObjectId()}@example.com`,
    password: "Qx7#vLmp92Zt",
    role,
    twoFactor: role === "admin" ? { enabled: true, secret: "MOCKSECRET", enrolledAt: new Date() } : { enabled: false },
  });

const tokenFor = (user) =>
  jwt.sign(
    {
      userId: user._id,
      role: user.role,
      sessionId: "s1",
      is2FAVerified: user.role === "admin" ? true : false,
    },
    JWT_SECRET,
    {
      expiresIn: "15m",
    }
  );

describe("Management API", () => {
  let app;
  let admin;
  let adminToken;

  beforeEach(async () => {
    app = buildApp();
    admin = await makeUser("admin");
    adminToken = tokenFor(admin);
  });

  it("rejects unauthenticated callers with 401", async () => {
    const res = await request(app).get("/api/webhooks");
    expect(res.status).toBe(401);
  });

  it("rejects non-admin callers with 403", async () => {
    const student = await makeUser("student");
    const res = await request(app)
      .get("/api/webhooks")
      .set("Authorization", `Bearer ${tokenFor(student)}`);
    expect(res.status).toBe(403);
  });

  it("creates an endpoint and returns the secret exactly once; reads never expose it", async () => {
    const create = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "https://hooks.example.com/x", events: ["payment.confirmed"] });

    expect(create.status).toBe(201);
    expect(create.body.secret).toEqual(expect.any(String));
    expect(create.body.endpoint.secretEncrypted).toBeUndefined();
    const id = create.body.endpoint._id;

    const read = await request(app)
      .get(`/api/webhooks/${id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(read.status).toBe(200);
    expect(read.body.endpoint.secret).toBeUndefined();
    expect(read.body.endpoint.secretEncrypted).toBeUndefined();

    const list = await request(app)
      .get("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.endpoints[0].secretEncrypted).toBeUndefined();
  });

  it("rejects non-https and private-network URLs at registration", async () => {
    const nonHttps = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "http://hooks.example.com/x" });
    expect(nonHttps.status).toBe(400);

    const priv = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "https://10.0.0.1/x" });
    expect(priv.status).toBe(400);
  });

  it("rotates the secret and returns a new one", async () => {
    const create = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "https://hooks.example.com/x" });
    const id = create.body.endpoint._id;

    const rotate = await request(app)
      .post(`/api/webhooks/${id}/rotate-secret`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(rotate.status).toBe(200);
    expect(rotate.body.secret).toEqual(expect.any(String));
    expect(rotate.body.secret).not.toBe(create.body.secret);
  });

  it("pings an endpoint, creating a signed ping delivery that verifies", async () => {
    const create = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "https://hooks.example.com/x" });
    const id = create.body.endpoint._id;
    const secret = create.body.secret;

    const ping = await request(app)
      .post(`/api/webhooks/${id}/ping`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(ping.status).toBe(202);

    const rows = await WebhookDelivery.find({ eventType: "ping" });
    expect(rows).toHaveLength(1);

    // Deliver it and verify the signature with the created secret.
    const client = captureClient();
    await worker.processOne({ post: client.post, now: new Date() });
    expect(client.calls).toHaveLength(1);
    const { body, headers } = client.calls[0];
    expect(
      verifySignature({
        secret,
        timestamp: headers[WEBHOOK_HEADERS.TIMESTAMP],
        rawBody: body,
        signatureHeader: headers[WEBHOOK_HEADERS.SIGNATURE],
      })
    ).toBe(true);
  });

  it("lists deliveries filtered by status and redelivers a dead one", async () => {
    const create = await request(app)
      .post("/api/webhooks")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ url: "https://hooks.example.com/x" });
    const id = create.body.endpoint._id;

    // Seed a dead delivery directly.
    const dead = await WebhookDelivery.create({
      endpoint: id,
      eventId: crypto.randomUUID(),
      eventType: "payment.confirmed",
      payload: { data: {} },
      status: "dead",
      attemptCount: 3,
      nextAttemptAt: new Date(),
    });

    const list = await request(app)
      .get(`/api/webhooks/${id}/deliveries?status=dead`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.deliveries).toHaveLength(1);

    const redeliver = await request(app)
      .post(`/api/webhooks/${id}/deliveries/${dead._id}/redeliver`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(redeliver.status).toBe(200);

    const updated = await WebhookDelivery.findById(dead._id);
    expect(updated.status).toBe("pending");
  });
});
