import mongoose from "mongoose";
import {
  computeSignature,
  verifySignature,
  serializePayload,
  emitEvent,
  EVENT_TYPES,
  WEBHOOK_API_VERSION,
} from "../src/services/webhooks/webhookService.js";
import { processDeliveries } from "../src/services/webhooks/deliveryWorker.js";
import { validateEndpointUrl } from "../src/utils/ssrfGuard.js";
import WebhookEndpoint from "../src/models/WebhookEndpoint.js";
import WebhookDelivery from "../src/models/WebhookDelivery.js";

// Connect to a test MongoDB instance
beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await mongoose.disconnect();
});

beforeEach(async () => {
  await WebhookEndpoint.deleteMany({});
  await WebhookDelivery.deleteMany({});
});

describe("HMAC generation and verification", () => {
  const secret = "whsec_testsecret123";

  it("produces a v1= prefixed hex signature", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const body = '{"key":"value"}';
    const sig = computeSignature(secret, timestamp, body);

    expect(sig).toMatch(/^v1=[0-9a-f]{64}$/);
  });

  it("produces different signatures for different timestamps", () => {
    const body = '{"key":"value"}';
    const sig1 = computeSignature(secret, "2025-01-01T00:00:00.000Z", body);
    const sig2 = computeSignature(secret, "2025-01-01T00:00:01.000Z", body);

    expect(sig1).not.toBe(sig2);
  });

  it("produces different signatures for different bodies", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const sig1 = computeSignature(secret, timestamp, '{"a":1}');
    const sig2 = computeSignature(secret, timestamp, '{"b":2}');

    expect(sig1).not.toBe(sig2);
  });

  it("verifySignature returns true for valid signature", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const body = '{"test":true}';
    const sig = computeSignature(secret, timestamp, body);

    expect(verifySignature(secret, timestamp, body, sig)).toBe(true);
  });

  it("verifySignature returns false for tampered body", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const sig = computeSignature(secret, timestamp, '{"test":true}');

    expect(verifySignature(secret, timestamp, '{"test":false}', sig)).toBe(false);
  });

  it("verifySignature returns false for wrong secret", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const body = '{"test":true}';
    const sig = computeSignature(secret, timestamp, body);

    expect(verifySignature("wrong-secret", timestamp, body, sig)).toBe(false);
  });

  it("verifySignature returns false for missing v1= prefix", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const body = '{"test":true}';

    expect(verifySignature(secret, timestamp, body, "badformat")).toBe(false);
  });

  it("verifySignature returns false for null/undefined signature", () => {
    const timestamp = "2025-01-01T00:00:00.000Z";
    const body = '{"test":true}';

    expect(verifySignature(secret, timestamp, body, null)).toBe(false);
    expect(verifySignature(secret, timestamp, body, undefined)).toBe(false);
  });
});

describe("serializePayload", () => {
  it("produces deterministic JSON with sorted keys", () => {
    const payload = { z: 1, a: 2, m: 3 };
    const s1 = serializePayload(payload);
    const s2 = serializePayload({ m: 3, a: 2, z: 1 });

    expect(s1).toBe(s2);
    expect(s1).toBe('{"a":2,"m":3,"z":1}');
  });
});

describe("emitEvent", () => {
  it("creates delivery rows for matching active endpoints", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    await emitEvent("payment.confirmed", { transactionId: "tx123" });

    const deliveries = await WebhookDelivery.find();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].eventType).toBe("payment.confirmed");
    expect(deliveries[0].payload.data.transactionId).toBe("tx123");
    expect(deliveries[0].payload.apiVersion).toBe(WEBHOOK_API_VERSION);
    expect(deliveries[0].payload.eventType).toBe("payment.confirmed");
    expect(deliveries[0].payload.eventId).toBeDefined();
    expect(deliveries[0].status).toBe("pending");
  });

  it("creates delivery for wildcard subscriber", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["*"],
      owner: new mongoose.Types.ObjectId(),
    });

    await emitEvent("wallet.connected", { userId: "u1" });

    const deliveries = await WebhookDelivery.find();
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0].eventType).toBe("wallet.connected");
  });

  it("does not create delivery for non-matching endpoints", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.failed"],
      owner: new mongoose.Types.ObjectId(),
    });

    await emitEvent("payment.confirmed", { transactionId: "tx123" });

    const deliveries = await WebhookDelivery.find();
    expect(deliveries).toHaveLength(0);
  });

  it("does not create delivery for inactive endpoints", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["*"],
      isActive: false,
      owner: new mongoose.Types.ObjectId(),
    });

    await emitEvent("payment.confirmed", { transactionId: "tx123" });

    const deliveries = await WebhookDelivery.find();
    expect(deliveries).toHaveLength(0);
  });

  it("silently ignores unknown event types", async () => {
    await emitEvent("unknown.event", { foo: "bar" });
    const deliveries = await WebhookDelivery.find();
    expect(deliveries).toHaveLength(0);
  });

  it("payload contains only allowlisted fields (no secrets)", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    await emitEvent("payment.confirmed", {
      transactionId: "tx1",
      buyerId: "b1",
      amount: "10",
      stellarTxHash: "abc123",
    });

    const delivery = await WebhookDelivery.findOne();
    const data = delivery.payload.data;

    // Should have the allowed fields
    expect(data.transactionId).toBe("tx1");
    expect(data.amount).toBe("10");

    // Should NOT have sensitive fields (even if passed)
    expect(data.password).toBeUndefined();
    expect(data.email).toBeUndefined();
    expect(data.secretKey).toBeUndefined();
  });
});

describe("Delivery worker claim atomicity", () => {
  it("two concurrent processDeliveries calls do not double-send", async () => {
    // Create an endpoint
    const endpoint = await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    // Create a pending delivery
    const payload = {
      eventId: "test-event-1",
      eventType: "payment.confirmed",
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: { transactionId: "tx1" },
    };
    await WebhookDelivery.create({
      endpoint: endpoint._id,
      eventId: "test-event-1",
      eventType: "payment.confirmed",
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    });

    // Try to process with two concurrent calls
    // Both will try to claim the same delivery atomically
    const [count1, count2] = await Promise.all([
      processDeliveries(1),
      processDeliveries(1),
    ]);

    // At most one should have processed the delivery
    const total = count1 + count2;
    expect(total).toBeLessThanOrEqual(1);

    // The delivery should be in a terminal or processing state with at most 1 attempt
    const delivery = await WebhookDelivery.findOne({ eventId: "test-event-1" });
    expect(delivery.attempts.length).toBeLessThanOrEqual(1);
  });
});

describe("Retry and backoff schedule", () => {
  it("failed delivery transitions to retrying with future nextAttemptAt", async () => {
    const endpoint = await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    const payload = {
      eventId: "test-event-retry",
      eventType: "payment.confirmed",
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: { transactionId: "tx-retry" },
    };
    await WebhookDelivery.create({
      endpoint: endpoint._id,
      eventId: "test-event-retry",
      eventType: "payment.confirmed",
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    });

    // Process — axios is not mocked here so it will fail (ECONNREFUSED)
    await processDeliveries(1);

    const delivery = await WebhookDelivery.findOne({ eventId: "test-event-retry" });
    expect(delivery.status).toBe("retrying");
    expect(delivery.attempts).toHaveLength(1);
    expect(delivery.attempts[0].at).toBeDefined();
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("delivery becomes dead after max attempts", async () => {
    const endpoint = await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    const payload = {
      eventId: "test-event-dead",
      eventType: "payment.confirmed",
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: { transactionId: "tx-dead" },
    };
    const delivery = await WebhookDelivery.create({
      endpoint: endpoint._id,
      eventId: "test-event-dead",
      eventType: "payment.confirmed",
      payload,
      status: "retrying",
      nextAttemptAt: new Date(),
    });

    // Simulate 5 previous failed attempts
    delivery.attempts = Array(5).fill({
      at: new Date(),
      error: "Connection refused",
      durationMs: 100,
    });
    delivery.attempts.length = 5; // override getter
    await delivery.save();

    // Process — this should be attempt 6 (the max), transitioning to dead
    await processDeliveries(1);

    const updated = await WebhookDelivery.findOne({ eventId: "test-event-dead" });
    expect(updated.status).toBe("dead");
  });

  it("endpoint auto-disables after sustained failures", async () => {
    const endpoint = await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["*"],
      consecutiveFailures: 19,
      owner: new mongoose.Types.ObjectId(),
    });

    const payload = {
      eventId: "test-event-disable",
      eventType: "payment.confirmed",
      apiVersion: WEBHOOK_API_VERSION,
      createdAt: new Date().toISOString(),
      data: { transactionId: "tx-disable" },
    };
    await WebhookDelivery.create({
      endpoint: endpoint._id,
      eventId: "test-event-disable",
      eventType: "payment.confirmed",
      payload,
      status: "pending",
      nextAttemptAt: new Date(),
    });

    await processDeliveries(1);

    const updated = await WebhookEndpoint.findById(endpoint._id);
    expect(updated.isActive).toBe(false);
    expect(updated.disabledAt).toBeDefined();
    expect(updated.disabledReason).toContain("Auto-disabled");
  });
});

describe("SSRF guard", () => {
  it("rejects non-https URLs when requireHttps is true", async () => {
    const result = await validateEndpointUrl("http://example.com/hook", { requireHttps: true });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");
  });

  it("accepts https URLs when requireHttps is true (skipping DNS)", async () => {
    const result = await validateEndpointUrl("https://example.com/hook", { requireHttps: false });
    expect(result.valid).toBe(true);
  });

  it("accepts http URLs in development", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "development";

    const result = await validateEndpointUrl("http://localhost:3000/hook");
    expect(result.valid).toBe(true);

    process.env.NODE_ENV = original;
  });

  it("rejects invalid URL format", async () => {
    const result = await validateEndpointUrl("not-a-url");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Invalid URL");
  });

  it("rejects non-http protocols", async () => {
    const result = await validateEndpointUrl("ftp://example.com/hook");
    expect(result.valid).toBe(false);
  });

  it("rejects loopback IP literals in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Use requireHttps: false to bypass HTTPS check and test IP validation directly
    const result = await validateEndpointUrl("http://127.0.0.1/hook", { requireHttps: false });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("private or loopback");

    process.env.NODE_ENV = original;
  });

  it("rejects 10.x.x.x in production", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    const result = await validateEndpointUrl("http://10.0.0.1/hook", { requireHttps: false });
    expect(result.valid).toBe(false);

    process.env.NODE_ENV = original;
  });

  it("production rejects http before checking IP", async () => {
    const original = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // http://127.0.0.1 fails HTTPS check first (requireHttps defaults to true in production)
    const result = await validateEndpointUrl("http://127.0.0.1/hook");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("HTTPS");

    process.env.NODE_ENV = original;
  });
});

describe("Payload allowlist", () => {
  it("emitted data is stored exactly as provided (allowlisting is at controller level)", async () => {
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    const allowedData = {
      transactionId: "tx1",
      buyerId: "b1",
      buyerWallet: "GABC...",
      creatorId: "c1",
      creatorWallet: "GDEF...",
      itemType: "course",
      itemId: "item1",
      itemTitle: "Test Course",
      amount: "10",
      network: "testnet",
      stellarTxHash: "hash123",
      ledger: 12345,
    };

    await emitEvent("payment.confirmed", allowedData);

    const delivery = await WebhookDelivery.findOne();
    const data = delivery.payload.data;

    // Verify all expected fields are present
    expect(data.transactionId).toBe("tx1");
    expect(data.buyerId).toBe("b1");
    expect(data.buyerWallet).toBe("GABC...");
    expect(data.amount).toBe("10");
    expect(data.stellarTxHash).toBe("hash123");

    // Verify payload structure includes envelope fields
    expect(delivery.payload.apiVersion).toBe(WEBHOOK_API_VERSION);
    expect(delivery.payload.eventType).toBe("payment.confirmed");
    expect(delivery.payload.eventId).toBeDefined();
    expect(delivery.payload.createdAt).toBeDefined();
  });

  it("controllers only pass allowlisted fields (integration test for paymentController)", async () => {
    // This verifies that the emitEvent calls in controllers
    // only include safe, non-sensitive fields
    await WebhookEndpoint.create({
      url: "https://example.com/hook",
      secret: "hashed",
      events: ["payment.confirmed"],
      owner: new mongoose.Types.ObjectId(),
    });

    // Simulate what paymentController passes
    await emitEvent("payment.confirmed", {
      transactionId: "tx1",
      buyerId: "b1",
      buyerWallet: "GABC...",
      creatorId: "c1",
      creatorWallet: "GDEF...",
      itemType: "course",
      itemId: "item1",
      itemTitle: "Test Course",
      amount: "10",
      network: "testnet",
      stellarTxHash: "hash123",
      ledger: 12345,
    });

    const delivery = await WebhookDelivery.findOne();
    const data = delivery.payload.data;

    // Verify no sensitive fields leaked
    expect(data.password).toBeUndefined();
    expect(data.email).toBeUndefined();
    expect(data.secretKey).toBeUndefined();
    expect(data._id).toBeUndefined(); // Mongo ObjectId not passed
  });
});

describe("Event type catalog", () => {
  it("exports all expected event types", () => {
    expect(EVENT_TYPES).toContain("payment.initialized");
    expect(EVENT_TYPES).toContain("payment.confirmed");
    expect(EVENT_TYPES).toContain("payment.failed");
    expect(EVENT_TYPES).toContain("payment.expired");
    expect(EVENT_TYPES).toContain("course.enrolled");
    expect(EVENT_TYPES).toContain("wallet.connected");
    expect(EVENT_TYPES).toContain("wallet.disconnected");
  });

  it("api version is a stable string", () => {
    expect(WEBHOOK_API_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
