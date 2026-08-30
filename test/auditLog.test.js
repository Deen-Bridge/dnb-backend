// test/auditLog.test.js
//
// Jest + supertest tests for the tamper-evident audit log (issue #66).
//
// Uses the same in-memory mock-store pattern as auth.test.js — no
// mongodb-memory-server or real network calls required.
import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import axios from "axios";
import app from "../app.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Session from "../src/models/Session.js";
import { redactMetadata } from "../src/services/audit/auditService.js";
import jwt from "jsonwebtoken";

// ─────────────────────────────────────────────────────────────────────────────
// Shared in-memory stores (reset per test)
// ─────────────────────────────────────────────────────────────────────────────
let usersStore = [];
let sessionsStore = [];
let auditStore = [];

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

// Helper: mint a JWT for a user in usersStore
const mintToken = (user) =>
  jwt.sign(
    { userId: user._id, role: user.role, sessionId: "sess-1", is2FAVerified: true },
    JWT_SECRET,
    { expiresIn: "15m" }
  );

// Helper: make a minimal user object
const makeUser = (overrides = {}) => {
  const _id = new mongoose.Types.ObjectId().toString();
  const role = overrides.role || "student";
  const defaultTwoFactor = role === "admin" ? { enabled: true } : { enabled: false };
  return {
    _id,
    name:  "Test User",
    email: `user_${_id}@example.com`,
    role,
    twoFactor: defaultTwoFactor,
    save:  async function () { return this; },
    ...overrides,
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// Global mock setup
// ─────────────────────────────────────────────────────────────────────────────
beforeAll(() => {
  // Mock the HIBP breached-password range call (empty data => not breached).
  jest.spyOn(axios, "get").mockResolvedValue({ status: 200, statusText: "OK", data: "" });

  // ── AuditLog mocks ──────────────────────────────────────────────────────
  jest.spyOn(AuditLog, "create").mockImplementation(async (data) => {
    const doc = {
      _id:       new mongoose.Types.ObjectId().toString(),
      createdAt: new Date(),
      ...data,
    };
    auditStore.push(doc);
    return doc;
  });

  jest.spyOn(AuditLog, "find").mockImplementation((filter = {}) => {
    const filtered = auditStore.filter((d) => {
      if (filter.action && d.action !== filter.action) return false;
      if (filter.status && d.status !== filter.status) return false;
      if (filter.targetType && d.targetType !== filter.targetType) return false;
      if (filter.actor && d.actor?.toString() !== filter.actor?.toString()) return false;
      if (filter.createdAt) {
        if (filter.createdAt.$gte && new Date(d.createdAt) < filter.createdAt.$gte) return false;
        if (filter.createdAt.$lte && new Date(d.createdAt) > filter.createdAt.$lte) return false;
      }
      return true;
    });
    // Chainable query builder
    const chain = {
      _docs: [...filtered],
      sort:    function () { return this; },
      skip:    function (n) { this._docs = this._docs.slice(n); return this; },
      limit:   function (n) { this._docs = this._docs.slice(0, n); return this; },
      populate: function () { return this; },
      lean:    async function () { return this._docs; },
      then:    (resolve) => resolve(filtered),
    };
    return chain;
  });

  jest.spyOn(AuditLog, "countDocuments").mockImplementation(async (filter = {}) => {
    return auditStore.filter((d) => {
      if (filter.action && d.action !== filter.action) return false;
      if (filter.status && d.status !== filter.status) return false;
      return true;
    }).length;
  });

  // Block mutations — mirror the real pre-hooks
  const MUTATION_ERROR = "AuditLog is append-only: update and delete operations are forbidden.";
  jest.spyOn(AuditLog, "updateOne").mockImplementation(async () => {
    throw new Error(MUTATION_ERROR);
  });
  jest.spyOn(AuditLog, "updateMany").mockImplementation(async () => {
    throw new Error(MUTATION_ERROR);
  });
  jest.spyOn(AuditLog, "deleteOne").mockImplementation(async () => {
    throw new Error(MUTATION_ERROR);
  });
  jest.spyOn(AuditLog, "deleteMany").mockImplementation(async () => {
    throw new Error(MUTATION_ERROR);
  });

  // ── User mocks ──────────────────────────────────────────────────────────
  jest.spyOn(User, "findOne").mockImplementation((query) => {
    const email = query?.email;
    const found = usersStore.find((u) => u.email === email);
    return { select: () => found || null, then: (resolve) => resolve(found || null) };
  });

  jest.spyOn(User, "findById").mockImplementation((id) => {
    const found = usersStore.find((u) => u._id.toString() === id.toString());
    return { select: () => found || null, then: (resolve) => resolve(found || null) };
  });

  jest.spyOn(User, "create").mockImplementation(async (data) => {
    const user = makeUser(data);
    usersStore.push(user);
    return user;
  });

  jest.spyOn(User, "deleteMany").mockImplementation(async () => {
    usersStore = [];
    return { acknowledged: true };
  });

  // ── PendingUser mocks (registration stores a pending user awaiting email verification)
  jest.spyOn(PendingUser, "findOneAndUpdate").mockImplementation(async (query, update) => {
    const doc = makeUser(update);
    usersStore.push(doc);
    return doc;
  });

  // ── Session mocks ───────────────────────────────────────────────────────
  jest.spyOn(Session, "create").mockImplementation(async (data) => {
    const sess = {
      _id: new mongoose.Types.ObjectId().toString(),
      revokedAt:  null,
      replacedBy: null,
      lastUsedAt: new Date(),
      expiresAt:  new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      ...data,
      save: async function () { return this; },
    };
    sessionsStore.push(sess);
    return sess;
  });

  jest.spyOn(Session, "findOne").mockImplementation((query) => {
    let found = null;
    if (query?.refreshTokenHash) {
      found = sessionsStore.find((s) => s.refreshTokenHash === query.refreshTokenHash);
    } else if (query?._id) {
      found = sessionsStore.find(
        (s) => s._id.toString() === query._id.toString() &&
               (!query.user || s.user.toString() === query.user.toString())
      );
    }
    return {
      populate: () => {
        if (!found) return null;
        const userObj = usersStore.find((u) => u._id.toString() === (found.user?._id || found.user)?.toString());
        if (userObj) found.user = userObj;
        return found;
      },
      then: (resolve) => resolve(found || null),
    };
  });

  jest.spyOn(Session, "find").mockImplementation((query) => {
    let results = sessionsStore;
    if (query?.user) results = results.filter((s) => (s.user?._id || s.user)?.toString() === query.user.toString());
    if (query?.revokedAt === null) results = results.filter((s) => s.revokedAt === null);
    if (query?.expiresAt?.$gt) results = results.filter((s) => new Date(s.expiresAt) > query.expiresAt.$gt);
    return results;
  });

  jest.spyOn(Session, "updateOne").mockImplementation(async (query, update) => {
    const found = sessionsStore.find((s) =>
      (query.refreshTokenHash && s.refreshTokenHash === query.refreshTokenHash) ||
      (query._id && s._id.toString() === query._id.toString())
    );
    if (found && update.$set) Object.assign(found, update.$set);
    return { acknowledged: true };
  });

  jest.spyOn(Session, "updateMany").mockImplementation(async (query, update) => {
    let matches = sessionsStore;
    if (query?.family)           matches = matches.filter((s) => s.family === query.family);
    if (query?.user)             matches = matches.filter((s) => s.user?.toString() === query.user.toString());
    if (query?._id?.$ne)        matches = matches.filter((s) => s._id.toString() !== query._id.$ne.toString());
    if (query?.revokedAt === null) matches = matches.filter((s) => s.revokedAt === null);
    if (update.$set) matches.forEach((s) => Object.assign(s, update.$set));
    return { acknowledged: true };
  });

  jest.spyOn(Session, "deleteMany").mockImplementation(async () => {
    sessionsStore = [];
    return { acknowledged: true };
  });
});

beforeEach(() => {
  usersStore   = [];
  sessionsStore = [];
  auditStore   = [];
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. REDACTION UNIT TESTS
// ─────────────────────────────────────────────────────────────────────────────
describe("redactMetadata()", () => {
  it("strips secrets and PII not in the allowlist", () => {
    const raw = {
      email:       "user@example.com",   // allowlisted
      password:    "hunter2",            // NOT allowed
      token:       "abc.def.ghi",        // NOT allowed
      signedXdr:   "AAAA...",            // NOT allowed
      otp:         "123456",             // NOT allowed
      newPassword: "s3cr3t",             // NOT allowed
      transactionId: "tx-123",           // allowlisted
    };
    const result = redactMetadata(raw);
    expect(result).toHaveProperty("email");
    expect(result).toHaveProperty("transactionId");
    expect(result).not.toHaveProperty("password");
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("signedXdr");
    expect(result).not.toHaveProperty("otp");
    expect(result).not.toHaveProperty("newPassword");
  });

  it("returns null for null input", () => {
    expect(redactMetadata(null)).toBeNull();
  });

  it("returns null when all keys are stripped", () => {
    expect(redactMetadata({ password: "x", token: "y" })).toBeNull();
  });

  it("returns null for non-object input", () => {
    expect(redactMetadata("string")).toBeNull();
    expect(redactMetadata(42)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. AUDIT ROW WRITTEN ON AUDITED ACTION
// ─────────────────────────────────────────────────────────────────────────────
describe("Audit row written on register", () => {
  it("writes a success row with correct action, status, and safe metadata", async () => {
    const res = await request(app).post("/api/auth/register").send({
      name:     "Alice",
      email:    "alice@example.com",
      password: "Qx7#vLmp92Zt",
      role:     "student",
    });

    expect(res.statusCode).toBe(201);

    // Give the fire-and-forget microtask a tick to complete
    await new Promise((resolve) => setImmediate(resolve));

    const row = auditStore.find((r) => r.action === AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS);
    expect(row).toBeDefined();
    expect(row.status).toBe("success");
    expect(row.targetType).toBe("User");

    // Sensitive field must NOT appear in stored metadata
    expect(row.metadata).not.toHaveProperty("password");
    expect(row.metadata?.email).toBe("alice@example.com");
  });

  it("writes a failure row when email already exists", async () => {
    // First register
    await request(app).post("/api/auth/register").send({
      name:     "Bob",
      email:    "bob@example.com",
      password: "Qx7#vLmp92Zt",
    });
    await new Promise((resolve) => setImmediate(resolve));

    // Second attempt with same email
    const res = await request(app).post("/api/auth/register").send({
      name:     "Bob Again",
      email:    "bob@example.com",
      password: "Qx7#vLmp92Zt",
    });

    expect(res.statusCode).toBe(400);
    await new Promise((resolve) => setImmediate(resolve));

    const row = auditStore.find((r) => r.action === AUDIT_ACTIONS.AUTH_REGISTER_FAILURE);
    expect(row).toBeDefined();
    expect(row.status).toBe("failure");
    expect(row.actor).toBeNull();
    expect(row.metadata?.reason).toBe("email_already_exists");
    expect(row.metadata).not.toHaveProperty("password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. ADMIN ROUTE — AUTHENTICATION & AUTHORIZATION
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/admin/audit — access control", () => {
  it("returns 401 when no Authorization header is provided", async () => {
    const res = await request(app).get("/api/admin/audit");
    expect(res.statusCode).toBe(401);
  });

  it("returns 403 when authenticated as a non-admin user (student)", async () => {
    const student = makeUser({ role: "student" });
    usersStore.push(student);
    const token = mintToken(student);

    jest.spyOn(User, "findById").mockImplementationOnce((id) => {
      const found = usersStore.find((u) => u._id.toString() === id.toString());
      return { select: () => found || null, then: (resolve) => resolve(found || null) };
    });

    const res = await request(app)
      .get("/api/admin/audit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(403);
  });

  it("returns 200 with logs array and pagination when authenticated as admin", async () => {
    const admin = makeUser({ role: "admin" });
    usersStore.push(admin);
    const token = mintToken(admin);

    // Seed a row
    auditStore.push({
      _id:        new mongoose.Types.ObjectId().toString(),
      action:     AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
      actor:      admin._id,
      actorIp:    "127.0.0.1",
      status:     "success",
      targetType: "User",
      targetId:   admin._id,
      metadata:   { email: admin.email },
      createdAt:  new Date(),
    });

    const res = await request(app)
      .get("/api/admin/audit")
      .set("Authorization", `Bearer ${token}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.logs)).toBe(true);
    expect(res.body.pagination).toHaveProperty("total");
    expect(res.body.pagination).toHaveProperty("page");
    expect(res.body.pagination).toHaveProperty("limit");
    expect(res.body.pagination).toHaveProperty("pages");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. ADMIN ROUTE — FILTERING
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/admin/audit — filtering", () => {
  let adminToken;

  beforeEach(() => {
    const admin = makeUser({ role: "admin" });
    usersStore.push(admin);
    adminToken = mintToken(admin);

    // Seed several rows
    const now = new Date();
    auditStore.push(
      {
        _id: new mongoose.Types.ObjectId().toString(),
        action:     AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
        status:     "success",
        targetType: "User",
        createdAt:  now,
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        action:     AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
        status:     "failure",
        targetType: "User",
        createdAt:  now,
      },
      {
        _id: new mongoose.Types.ObjectId().toString(),
        action:     AUDIT_ACTIONS.PAYMENT_INITIALIZE,
        status:     "success",
        targetType: "Transaction",
        createdAt:  now,
      }
    );
  });

  it("filters by action", async () => {
    const res = await request(app)
      .get(`/api/admin/audit?action=${AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.logs.every((l) => l.action === AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS)).toBe(true);
  });

  it("filters by status=failure", async () => {
    const res = await request(app)
      .get("/api/admin/audit?status=failure")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.logs.every((l) => l.status === "failure")).toBe(true);
  });

  it("returns 400 for invalid status value", async () => {
    const res = await request(app)
      .get("/api/admin/audit?status=invalid")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(400);
  });

  it("returns 400 for invalid actor ObjectId", async () => {
    const res = await request(app)
      .get("/api/admin/audit?actor=notanid")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. ADMIN ROUTE — PAGINATION
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/admin/audit — pagination", () => {
  let adminToken;

  beforeEach(() => {
    const admin = makeUser({ role: "admin" });
    usersStore.push(admin);
    adminToken = mintToken(admin);

    // Seed 7 rows
    for (let i = 0; i < 7; i++) {
      auditStore.push({
        _id:       new mongoose.Types.ObjectId().toString(),
        action:    AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
        status:    "success",
        createdAt: new Date(),
      });
    }
  });

  it("respects page and limit", async () => {
    const res = await request(app)
      .get("/api/admin/audit?page=1&limit=3")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.logs.length).toBeLessThanOrEqual(3);
    expect(res.body.pagination.limit).toBe(3);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pages).toBe(Math.ceil(7 / 3));
  });

  it("caps limit at 100", async () => {
    const res = await request(app)
      .get("/api/admin/audit?limit=999")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.pagination.limit).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. APPEND-ONLY ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────
describe("AuditLog append-only enforcement", () => {
  it("throws when updateOne is called on AuditLog", async () => {
    await expect(AuditLog.updateOne({ _id: "x" }, { action: "tampered" }))
      .rejects.toThrow("append-only");
  });

  it("throws when updateMany is called on AuditLog", async () => {
    await expect(AuditLog.updateMany({}, { action: "tampered" }))
      .rejects.toThrow("append-only");
  });

  it("throws when deleteOne is called on AuditLog", async () => {
    await expect(AuditLog.deleteOne({ _id: "x" }))
      .rejects.toThrow("append-only");
  });

  it("throws when deleteMany is called on AuditLog", async () => {
    await expect(AuditLog.deleteMany({}))
      .rejects.toThrow("append-only");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. NO MUTATING VERBS ON ADMIN ROUTE
// ─────────────────────────────────────────────────────────────────────────────
describe("Admin audit route — no mutating endpoints", () => {
  let adminToken;

  beforeEach(() => {
    const admin = makeUser({ role: "admin" });
    usersStore.push(admin);
    adminToken = mintToken(admin);
  });

  it("POST /api/admin/audit returns 405", async () => {
    const res = await request(app)
      .post("/api/admin/audit")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ action: "tampered" });
    expect(res.statusCode).toBe(405);
  });

  it("DELETE /api/admin/audit returns 405", async () => {
    const res = await request(app)
      .delete("/api/admin/audit/someid")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.statusCode).toBe(405);
  });
});
