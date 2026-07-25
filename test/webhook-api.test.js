import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import app from "../app.js";
import WebhookEndpoint from "../src/models/WebhookEndpoint.js";
import WebhookDelivery from "../src/models/WebhookDelivery.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

let adminToken;
let userToken;
let adminUserId;
let regularUserId;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  // Create test users
  adminUserId = new mongoose.Types.ObjectId();
  regularUserId = new mongoose.Types.ObjectId();

  adminToken = jwt.sign({ userId: adminUserId, sessionId: "s1" }, JWT_SECRET, { expiresIn: "1h" });
  userToken = jwt.sign({ userId: regularUserId, sessionId: "s2" }, JWT_SECRET, { expiresIn: "1h" });
});

afterAll(async () => {
  await WebhookEndpoint.deleteMany({});
  await WebhookDelivery.deleteMany({});
  await mongoose.disconnect();
});

beforeEach(async () => {
  await WebhookEndpoint.deleteMany({});
  await WebhookDelivery.deleteMany({});
});

const authHeader = (token) => ({ Authorization: `Bearer ${token}` });

describe("Webhook Management API", () => {
  describe("POST /api/webhooks", () => {
    it("creates an endpoint and returns the raw secret once", async () => {
      // Need to mock the User model for protect middleware
      // Since we're using a real DB, create a user document
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const res = await request(app)
        .post("/api/webhooks")
        .set(authHeader(adminToken))
        .send({
          url: "https://example.com/hook",
          events: ["payment.confirmed"],
          description: "Test endpoint",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.secret).toMatch(/^whsec_/);
      expect(res.body.endpoint.url).toBe("https://example.com/hook");
      expect(res.body.endpoint.events).toEqual(["payment.confirmed"]);

      // Secret should NOT be stored in plaintext
      const stored = await WebhookEndpoint.findById(res.body.endpoint._id).select("+secret");
      expect(stored.secret).not.toBe(res.body.secret);
      expect(stored.secret).not.toMatch(/^whsec_/); // should be hashed
    });

    it("rejects invalid event types", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const res = await request(app)
        .post("/api/webhooks")
        .set(authHeader(adminToken))
        .send({
          url: "https://example.com/hook",
          events: ["invalid.event"],
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("Invalid event types");
    });

    it("rejects missing url", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const res = await request(app)
        .post("/api/webhooks")
        .set(authHeader(adminToken))
        .send({
          events: ["payment.confirmed"],
        });

      expect(res.statusCode).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(app)
        .post("/api/webhooks")
        .send({
          url: "https://example.com/hook",
          events: ["payment.confirmed"],
        });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("GET /api/webhooks", () => {
    it("returns endpoints for the authenticated user", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: regularUserId,
        name: "User",
        email: "user@test.com",
        password: "hashed",
        role: "student",
      });

      await WebhookEndpoint.create({
        url: "https://example.com/hook1",
        secret: "hashed",
        events: ["payment.confirmed"],
        owner: regularUserId,
      });

      const res = await request(app)
        .get("/api/webhooks")
        .set(authHeader(userToken));

      expect(res.statusCode).toBe(200);
      expect(res.body.endpoints).toHaveLength(1);
    });
  });

  describe("GET /api/webhooks/events", () => {
    it("returns the event type catalog", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: regularUserId,
        name: "User",
        email: "user@test.com",
        password: "hashed",
        role: "student",
      });

      const res = await request(app)
        .get("/api/webhooks/events")
        .set(authHeader(userToken));

      expect(res.statusCode).toBe(200);
      expect(res.body.events).toContain("payment.confirmed");
      expect(res.body.events).toContain("course.enrolled");
    });
  });

  describe("POST /api/webhooks/:id/rotate-secret", () => {
    it("returns a new raw secret", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const endpoint = await WebhookEndpoint.create({
        url: "https://example.com/hook",
        secret: "oldhash",
        events: ["*"],
        owner: adminUserId,
      });

      const res = await request(app)
        .post(`/api/webhooks/${endpoint._id}/rotate-secret`)
        .set(authHeader(adminToken));

      expect(res.statusCode).toBe(200);
      expect(res.body.secret).toMatch(/^whsec_/);

      // Verify the stored hash changed
      const updated = await WebhookEndpoint.findById(endpoint._id).select("+secret");
      expect(updated.secret).not.toBe("oldhash");
    });
  });

  describe("POST /api/webhooks/:id/ping", () => {
    it("emits a ping event", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const endpoint = await WebhookEndpoint.create({
        url: "https://example.com/hook",
        secret: "hashed",
        events: ["*"],
        owner: adminUserId,
      });

      const res = await request(app)
        .post(`/api/webhooks/${endpoint._id}/ping`)
        .set(authHeader(adminToken));

      expect(res.statusCode).toBe(200);
      expect(res.body.message).toContain("Ping");

      // Should have created a delivery
      const deliveries = await WebhookDelivery.find({ endpoint: endpoint._id });
      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].payload.data.ping).toBe(true);
    });
  });

  describe("POST /api/webhooks/:id/deliveries/:deliveryId/redeliver", () => {
    it("queues a dead delivery for redelivery", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const endpoint = await WebhookEndpoint.create({
        url: "https://example.com/hook",
        secret: "hashed",
        events: ["*"],
        owner: adminUserId,
      });

      const delivery = await WebhookDelivery.create({
        endpoint: endpoint._id,
        eventId: "dead-event",
        eventType: "payment.confirmed",
        payload: { data: {} },
        status: "dead",
        nextAttemptAt: new Date(),
      });

      const res = await request(app)
        .post(`/api/webhooks/${endpoint._id}/deliveries/${delivery._id}/redeliver`)
        .set(authHeader(adminToken));

      expect(res.statusCode).toBe(200);

      const updated = await WebhookDelivery.findById(delivery._id);
      expect(updated.status).toBe("pending");
    });

    it("rejects redelivery of non-dead deliveries", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const endpoint = await WebhookEndpoint.create({
        url: "https://example.com/hook",
        secret: "hashed",
        events: ["*"],
        owner: adminUserId,
      });

      const delivery = await WebhookDelivery.create({
        endpoint: endpoint._id,
        eventId: "delivered-event",
        eventType: "payment.confirmed",
        payload: { data: {} },
        status: "delivered",
      });

      const res = await request(app)
        .post(`/api/webhooks/${endpoint._id}/deliveries/${delivery._id}/redeliver`)
        .set(authHeader(adminToken));

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toContain("Only dead deliveries");
    });
  });

  describe("DELETE /api/webhooks/:id", () => {
    it("deletes endpoint and its deliveries", async () => {
      const User = (await import("../src/models/User.js")).default;
      await User.create({
        _id: adminUserId,
        name: "Admin",
        email: "admin@test.com",
        password: "hashed",
        role: "admin",
      });

      const endpoint = await WebhookEndpoint.create({
        url: "https://example.com/hook",
        secret: "hashed",
        events: ["*"],
        owner: adminUserId,
      });

      await WebhookDelivery.create({
        endpoint: endpoint._id,
        eventId: "del1",
        eventType: "payment.confirmed",
        payload: { data: {} },
      });

      const res = await request(app)
        .delete(`/api/webhooks/${endpoint._id}`)
        .set(authHeader(adminToken));

      expect(res.statusCode).toBe(200);

      const remaining = await WebhookEndpoint.findById(endpoint._id);
      expect(remaining).toBeNull();

      const deliveries = await WebhookDelivery.find({ endpoint: endpoint._id });
      expect(deliveries).toHaveLength(0);
    });
  });
});
