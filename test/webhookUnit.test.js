import { jest } from "@jest/globals";
import express from "express";
import request from "supertest";

// External collaborators are mocked: no DB, no network, no auth backend.
const endpointModel = {
  create: jest.fn(),
  find: jest.fn(),
  findOne: jest.fn(),
  findById: jest.fn(),
  updateOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
};
const deliveryModel = { insertMany: jest.fn(), create: jest.fn() };

jest.unstable_mockModule("../src/models/WebhookEndpoint.js", () => ({
  default: endpointModel,
}));
jest.unstable_mockModule("../src/models/WebhookDelivery.js", () => ({
  default: deliveryModel,
  MAX_STORED_ATTEMPTS: 20,
  MAX_ERROR_LENGTH: 500,
}));
jest.unstable_mockModule("../src/services/audit/auditService.js", () => ({
  recordAudit: jest.fn(),
}));

let currentRole = "admin";
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (req, res, next) => {
    req.user = { _id: "507f1f77bcf86cd799439011", role: currentRole };
    next();
  },
  authorizeRoles:
    (...roles) =>
    (req, res, next) =>
      roles.includes(req.user.role)
        ? next()
        : res.status(403).json({ success: false, message: "Forbidden" }),
}));

const { signPayload, verifySignature, WEBHOOK_HEADERS } = await import(
  "../src/services/webhooks/signing.js"
);
const { validateWebhookUrl, isPrivateAddress, assertDeliverableUrl } = await import(
  "../src/services/webhooks/urlGuard.js"
);
const { emitEvent, sanitizeEventData, EVENT_TYPES } = await import(
  "../src/services/webhooks/webhookService.js"
);
const { encryptSecret, decryptSecret, generateSecret } = await import(
  "../src/services/webhooks/webhookSecret.js"
);
const { deliverClaimed, computeBackoffMs, MAX_ATTEMPTS } = await import(
  "../src/services/webhooks/deliveryWorker.js"
);
const { default: webhookRoutes } = await import("../src/routes/webhookRoutes.js");
const { errorHandler } = await import("../src/middlewares/errorHandler.js");

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/webhooks", webhookRoutes);
  app.use(errorHandler);
  return app;
};

const originalEnv = process.env.NODE_ENV;
afterEach(() => {
  jest.restoreAllMocks();
  Object.values(endpointModel).forEach((m) => m.mockReset());
  Object.values(deliveryModel).forEach((m) => m.mockReset());
  process.env.NODE_ENV = originalEnv;
  currentRole = "admin";
});

describe("webhook signing", () => {
  const secret = "s3cret";
  const rawBody = JSON.stringify({ hello: "world" });

  it("produces a v1 signature that verifies", () => {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signatureHeader = signPayload({ secret, timestamp, rawBody });
    expect(signatureHeader).toMatch(/^v1=[0-9a-f]{64}$/);
    expect(verifySignature({ secret, timestamp, rawBody, signatureHeader })).toBe(true);
  });

  it("rejects tampered body, wrong secret, stale timestamp and malformed header", () => {
    const now = Math.floor(Date.now() / 1000);
    const sig = signPayload({ secret, timestamp: now, rawBody });
    expect(verifySignature({ secret, timestamp: now, rawBody: "{}", signatureHeader: sig })).toBe(false);
    expect(verifySignature({ secret: "other", timestamp: now, rawBody, signatureHeader: sig })).toBe(false);
    const old = now - 3600;
    const oldSig = signPayload({ secret, timestamp: old, rawBody });
    expect(verifySignature({ secret, timestamp: old, rawBody, signatureHeader: oldSig })).toBe(false);
    expect(verifySignature({ secret, timestamp: now, rawBody, signatureHeader: "v2=abcd" })).toBe(false);
    expect(verifySignature({ secret, timestamp: now, rawBody, signatureHeader: undefined })).toBe(false);
    expect(verifySignature({ secret, timestamp: now, rawBody, signatureHeader: "v1=zz" })).toBe(false);
  });

  it("round-trips encrypted secrets and rejects malformed storage", () => {
    const s = generateSecret();
    expect(decryptSecret(encryptSecret(s))).toBe(s);
    expect(() => decryptSecret("bad")).toThrow(/Malformed/);
    expect(() => decryptSecret(undefined)).toThrow();
  });
});

describe("urlGuard (SSRF)", () => {
  it("accepts a public https URL", () => {
    expect(validateWebhookUrl("https://example.com/hook").hostname).toBe("example.com");
  });

  it.each([
    "https://localhost/x",
    "https://foo.localhost/x",
    "https://127.0.0.1/x",
    "https://10.1.2.3/x",
    "https://172.16.0.1/x",
    "https://192.168.1.1/x",
    "https://169.254.169.254/latest/meta-data",
    "https://[::1]/x",
    "https://[::ffff:127.0.0.1]/x",
    "ftp://example.com/x",
    "not a url",
  ])("rejects %s", (u) => {
    expect(() => validateWebhookUrl(u)).toThrow();
  });

  it("requires https outside development but allows http in development", () => {
    process.env.NODE_ENV = "test";
    expect(() => validateWebhookUrl("http://example.com")).toThrow(/https/);
    process.env.NODE_ENV = "development";
    expect(validateWebhookUrl("http://example.com").protocol).toBe("http:");
  });

  it("classifies private and public addresses", () => {
    expect(isPrivateAddress("100.64.0.1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
  });

  it("blocks hostnames that resolve to private IPs in production (mocked DNS)", async () => {
    const dns = (await import("dns")).default;
    process.env.NODE_ENV = "production";
    jest.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "10.0.0.5", family: 4 }]);
    const bad = await assertDeliverableUrl("https://evil.example.com");
    expect(bad.ok).toBe(false);
    expect(bad.reason).toMatch(/private/);

    jest.spyOn(dns.promises, "lookup").mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }]);
    expect((await assertDeliverableUrl("https://good.example.com")).ok).toBe(true);

    jest.spyOn(dns.promises, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));
    expect((await assertDeliverableUrl("https://nx.example.com")).ok).toBe(false);
  });
});

describe("webhookService.emitEvent", () => {
  it("strips non-allowlisted fields", () => {
    expect(sanitizeEventData({ transactionId: "t1", email: "a@b.c", password: "x" })).toEqual({
      transactionId: "t1",
    });
  });

  it("ignores unknown event types and no-ops without a DB connection", async () => {
    expect((await emitEvent("bogus.event")).deliveries).toBe(0);
    expect(endpointModel.find).not.toHaveBeenCalled();

    // No live DB connection in this suite: emission is a safe no-op.
    const res = await emitEvent(EVENT_TYPES.PING, {});
    expect(res.deliveries).toBe(0);
    expect(deliveryModel.insertMany).not.toHaveBeenCalled();
  });
});

describe("deliveryWorker.deliverClaimed", () => {
  const secret = generateSecret();
  const makeDelivery = (over = {}) => ({
    _id: "d1",
    endpoint: "e1",
    eventId: "evt-1",
    eventType: "ping",
    payload: { type: "ping", data: {} },
    attemptCount: 1,
    attempts: [],
    save: jest.fn().mockResolvedValue(undefined),
    ...over,
  });
  const mockEndpoint = (over = {}) => {
    const ep = {
      _id: "e1",
      url: "https://example.com/hook",
      isActive: true,
      secretEncrypted: encryptSecret(secret),
      ...over,
    };
    endpointModel.findById.mockReturnValue({ select: async () => ep });
    return ep;
  };

  it("posts a verifiable signed body and marks the delivery delivered", async () => {
    mockEndpoint();
    endpointModel.updateOne.mockResolvedValue({});
    const post = jest.fn().mockResolvedValue({ status: 200 });
    const delivery = makeDelivery();

    await deliverClaimed(delivery, { post });

    const [url, body, headers] = post.mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(body).toBe(JSON.stringify(delivery.payload));
    expect(
      verifySignature({
        secret,
        timestamp: headers[WEBHOOK_HEADERS.TIMESTAMP],
        rawBody: body,
        signatureHeader: headers[WEBHOOK_HEADERS.SIGNATURE],
      })
    ).toBe(true);
    expect(headers[WEBHOOK_HEADERS.EVENT_ID]).toBe("evt-1");
    expect(delivery.status).toBe("delivered");
    expect(endpointModel.updateOne).toHaveBeenCalled();
  });

  it("schedules a retry on a non-2xx response", async () => {
    mockEndpoint();
    const delivery = makeDelivery();
    const now = new Date();
    await deliverClaimed(delivery, { post: jest.fn().mockResolvedValue({ status: 500 }), now });
    expect(delivery.status).toBe("retrying");
    expect(delivery.lastError).toMatch(/500/);
    expect(delivery.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(now.getTime() + computeBackoffMs(1) - 30_000);
  });

  it("dead-letters after max attempts and counts the failure on the endpoint", async () => {
    mockEndpoint();
    endpointModel.findOneAndUpdate.mockResolvedValue({ isActive: true, consecutiveFailures: 1 });
    const delivery = makeDelivery({ attemptCount: MAX_ATTEMPTS });
    await deliverClaimed(delivery, { post: jest.fn().mockRejectedValue(new Error("ECONNRESET")) });
    expect(delivery.status).toBe("dead");
    expect(delivery.lastError).toBe("ECONNRESET");
    expect(endpointModel.findOneAndUpdate).toHaveBeenCalled();
  });

  it("does not POST when the target is blocked by the SSRF guard", async () => {
    mockEndpoint({ url: "https://127.0.0.1/hook" });
    const post = jest.fn();
    const delivery = makeDelivery();
    await deliverClaimed(delivery, { post });
    expect(post).not.toHaveBeenCalled();
    expect(delivery.lastError).toMatch(/SSRF/);
  });

  it("marks the delivery dead when the endpoint is inactive", async () => {
    mockEndpoint({ isActive: false });
    const post = jest.fn();
    const delivery = makeDelivery();
    await deliverClaimed(delivery, { post });
    expect(post).not.toHaveBeenCalled();
    expect(delivery.status).toBe("dead");
  });
});

describe("webhook routes", () => {
  it("creates an endpoint and returns the secret once", async () => {
    endpointModel.create.mockImplementation(async (doc) => ({
      _id: { toString: () => "e1" },
      toJSON: () => ({ id: "e1", url: doc.url, events: doc.events }),
      ...doc,
    }));
    const res = await request(buildApp())
      .post("/api/webhooks")
      .send({ url: "https://example.com/hook", events: ["payment.confirmed"] });

    expect(res.statusCode).toBe(201);
    expect(res.body.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(res.body.endpoint.secretEncrypted).toBeUndefined();
    expect(endpointModel.create.mock.calls[0][0].secretEncrypted).not.toContain(res.body.secret);
  });

  it("rejects private URLs, unknown events and missing url with 400", async () => {
    const app = buildApp();
    const ssrf = await request(app).post("/api/webhooks").send({ url: "https://169.254.169.254/" });
    expect(ssrf.statusCode).toBe(400);
    const badEvent = await request(app)
      .post("/api/webhooks")
      .send({ url: "https://example.com", events: ["nope"] });
    expect(badEvent.statusCode).toBe(400);
    const missing = await request(app).post("/api/webhooks").send({});
    expect(missing.statusCode).toBe(400);
    expect(endpointModel.create).not.toHaveBeenCalled();
  });

  it("forbids non-admin users and returns 404 for unknown endpoints", async () => {
    currentRole = "student";
    const forbidden = await request(buildApp()).get("/api/webhooks");
    expect(forbidden.statusCode).toBe(403);

    currentRole = "admin";
    endpointModel.findOne.mockResolvedValue(null);
    const missing = await request(buildApp()).get("/api/webhooks/507f1f77bcf86cd799439012");
    expect(missing.statusCode).toBe(404);
  });
});
