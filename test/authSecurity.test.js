// test/authSecurity.test.js
//
// Jest + supertest tests for the authentication abuse hardening (issue #89):
//  - progressive per-account login lockout (failedLoginAttempts + lockUntil)
//  - AUTH_ACCOUNT_LOCKED audit emission
//  - per-email signup / verification-resend throttling (survives IP rotation)
//  - captcha gate no-op when unconfigured
//
// Uses the in-memory mock-store pattern (no DB / no network / no HIBP).
import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcrypt";
import axios from "axios";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Session from "../src/models/Session.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";

// Set a small per-email window BEFORE importing the app so the email limiter
// (created at module load) picks up max=3 for the burst assertions. Cleaned up
// in afterAll so other suites re-import with the production defaults.
let app;

describe("Authentication abuse hardening (issue #89)", () => {
  let usersStore = [];
  let sessionsStore = [];
  let pendingStore = [];
  let auditStore = [];
  let emailAuthLimiter;
  let usedEmails = new Set();

  beforeAll(async () => {
    process.env.RATE_LIMIT_EMAIL_AUTH_MAX = "3";
    process.env.RATE_LIMIT_EMAIL_AUTH_WINDOW_MS = String(60 * 1000);
    ({ default: app } = await import("../app.js"));
    ({ emailAuthLimiter } = await import("../src/middlewares/security.js"));

    // Block real network: HIBP range GET + any POST axios would make.
    jest.spyOn(axios, "get").mockResolvedValue({ status: 200, statusText: "OK", data: "" });
    jest.spyOn(axios, "post").mockResolvedValue({ status: 200, statusText: "OK", data: {} });

    // ── AuditLog mock (recordAudit writes into auditStore) ────────────────
    jest.spyOn(AuditLog, "create").mockImplementation(async (data) => {
      const doc = { _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(), ...data };
      auditStore.push(doc);
      return doc;
    });

    // ── User mocks ─────────────────────────────────────────────────────────
    jest.spyOn(User, "findOne").mockImplementation((query) => {
      const email = query?.email;
      const found = usersStore.find((u) => u.email === email);
      return { select: () => found || null, then: (resolve) => resolve(found || null) };
    });

    jest.spyOn(User, "findById").mockImplementation((id) => {
      const found = usersStore.find((u) => u._id.toString() === id.toString());
      return { select: () => found || null, then: (resolve) => resolve(found || null) };
    });

    // Atomic $inc used by loginUser's failed-login path — applies the
    // increment to the same store object the assertions inspect.
    jest.spyOn(User, "findByIdAndUpdate").mockImplementation(async (id, update) => {
      const user = usersStore.find((u) => u._id.toString() === id.toString());
      if (!user) return null;
      if (update?.$inc) {
        for (const [field, amount] of Object.entries(update.$inc)) {
          user[field] = (user[field] || 0) + amount;
        }
      }
      return user;
    });

    jest.spyOn(User, "updateOne").mockImplementation(async (query, update) => {
      const user = usersStore.find((u) => u._id.toString() === query?._id?.toString());
      if (user && update?.$set) Object.assign(user, update.$set);
      return { acknowledged: true, modifiedCount: 1 };
    });

    jest.spyOn(User, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const user = { _id, ...data, save: async function () { return this; } };
      usersStore.push(user);
      return user;
    });

    jest.spyOn(User, "deleteMany").mockImplementation(async () => {
      usersStore = [];
      return { acknowledged: true };
    });

    // ── PendingUser mocks (register -> pending -> verify flow) ────────────
    jest.spyOn(PendingUser, "findOneAndUpdate").mockImplementation(async (query, update) => {
      let pending = pendingStore.find((p) => p.email === query?.email);
      if (pending) Object.assign(pending, update);
      else pending = { _id: new mongoose.Types.ObjectId().toString(), ...update };
      pending.save = async function () { return this; };
      pendingStore.push(pending);
      return pending;
    });

    jest.spyOn(PendingUser, "findOne").mockImplementation(async (query) => {
      if (query?.verificationToken) {
        return pendingStore.find((p) => p.verificationToken === query.verificationToken) || null;
      }
      if (query?.email) {
        return pendingStore.find((p) => p.email === query.email) || null;
      }
      return null;
    });

    jest.spyOn(PendingUser, "deleteOne").mockImplementation(async (query) => {
      pendingStore = pendingStore.filter((p) => p._id !== query?._id && p.email !== query?.email);
      return { deletedCount: 1 };
    });

    // ── Session mocks ──────────────────────────────────────────────────────
    jest.spyOn(Session, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const session = {
        _id,
        revokedAt: null,
        replacedBy: null,
        lastUsedAt: new Date(),
        ...data,
        save: async function () { return this; },
      };
      sessionsStore.push(session);
      return session;
    });

    jest.spyOn(Session, "find").mockImplementation((query) => sessionsStore);
    jest.spyOn(Session, "updateOne").mockImplementation(async () => ({ acknowledged: true }));
    jest.spyOn(Session, "updateMany").mockImplementation(async () => ({ acknowledged: true }));
    jest.spyOn(Session, "deleteMany").mockImplementation(async () => {
      sessionsStore = [];
      return { acknowledged: true };
    });
  });

  afterAll(() => {
    delete process.env.RATE_LIMIT_EMAIL_AUTH_MAX;
    delete process.env.RATE_LIMIT_EMAIL_AUTH_WINDOW_MS;
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    usersStore = [];
    sessionsStore = [];
    pendingStore = [];
    auditStore = [];
    // Reset the per-email limiter buckets so counters never carry across tests.
    for (const email of usedEmails) {
      emailAuthLimiter?.resetKey(`email:${email}`);
    }
    usedEmails = new Set();
  });

  const trackEmail = (email) => usedEmails.add(email);

  const makeUser = (overrides = {}) => {
    const _id = new mongoose.Types.ObjectId().toString();
    const user = {
      _id,
      name: "Lockout User",
      email: "lockout@example.com",
      password: "hash",
      role: "student",
      isVerified: true,
      failedLoginAttempts: 0,
      lockUntil: null,
      ...overrides,
    };
    user.save = async function () { return this; };
    return user;
  };

  const flushAudit = () => new Promise((resolve) => setImmediate(resolve));

  // ── 1. Progressive login lockout ─────────────────────────────────────────
  describe("progressive login lockout", () => {
    it("locks the account after N consecutive failures with escalating backoff", async () => {
      const email = "lockout@example.com";
      const user = makeUser({ email });
      usersStore.push(user);

      // 4 failures: still just 401s, counters increment.
      for (let i = 0; i < 4; i += 1) {
        const res = await request(app)
          .post("/api/auth/login")
          .send({ email, password: "wrong-password" });
        expect(res.statusCode).toBe(401);
      }
      expect(user.failedLoginAttempts).toBe(4);
      expect(user.lockUntil).toBeNull();

      // 5th failure: lock is applied.
      const fifth = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "wrong-password" });
      expect(fifth.statusCode).toBe(401);

      expect(user.failedLoginAttempts).toBe(5);
      expect(user.lockUntil).toBeInstanceOf(Date);
      expect(new Date(user.lockUntil).getTime()).toBeGreaterThan(Date.now());

      await flushAudit();
      expect(
        auditStore.some((a) => a.action === AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED && a.status === "failure")
      ).toBe(true);
    });

    it("rejects even a correct password while locked, without leaking the account exists", async () => {
      const email = "locked@example.com";
      const hashed = await bcrypt.hash("CorrectPass123!", 4);
      const user = makeUser({ email, password: hashed, failedLoginAttempts: 5, lockUntil: new Date(Date.now() + 60 * 1000) });
      usersStore.push(user);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "CorrectPass123!" });

      // Identical to a nonexistent-account login — no enumeration.
      expect(res.statusCode).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe("Invalid credentials");
      // The response must not reveal the account exists beyond the generic
      // "Invalid credentials" phrasing.
      expect(res.body.message).not.toMatch(/user|account exists|found|attempts/i);
      expect(user.failedLoginAttempts).toBe(5); // untouched while locked
    });

    it("auto-clears the lock after backoff and resets the counters on success", async () => {
      const email = "recovering@example.com";
      const hashed = await bcrypt.hash("CorrectPass123!", 4);
      const user = makeUser({
        email,
        password: hashed,
        failedLoginAttempts: 6,
        // Simulate the backoff window having elapsed (time advance).
        lockUntil: new Date(Date.now() - 1000),
      });
      usersStore.push(user);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "CorrectPass123!" });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(user.failedLoginAttempts).toBe(0);
      expect(user.lockUntil).toBeNull();
    });

    it("extends the lock with a longer backoff on further failures after expiry", async () => {
      const email = "escalating@example.com";
      const user = makeUser({
        email,
        failedLoginAttempts: 5,
        // Backoff for the first lock has elapsed (time advance).
        lockUntil: new Date(Date.now() - 1000),
      });
      usersStore.push(user);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "still-wrong" });

      expect(res.statusCode).toBe(401);
      expect(user.failedLoginAttempts).toBe(6);
      // 6th failure => base * 2^(6-5) = 2 minutes, not the 1-minute base.
      const remainingMs = new Date(user.lockUntil).getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(90 * 1000);
      expect(remainingMs).toBeLessThanOrEqual(120 * 1000);
    });

    it("caps the escalating backoff at LOGIN_LOCKOUT_MAX_MS", async () => {
      const email = "capped@example.com";
      const user = makeUser({
        email,
        failedLoginAttempts: 20,
        // Prior lock has long since elapsed.
        lockUntil: new Date(Date.now() - 1000),
      });
      usersStore.push(user);

      const res = await request(app)
        .post("/api/auth/login")
        .send({ email, password: "still-wrong" });

      expect(res.statusCode).toBe(401);
      expect(user.failedLoginAttempts).toBe(21);
      const maxMs = 24 * 60 * 60 * 1000; // LOGIN_LOCKOUT_MAX_MS default (24h)
      const remainingMs = new Date(user.lockUntil).getTime() - Date.now();
      expect(remainingMs).toBeGreaterThan(maxMs - 60 * 1000);
      expect(remainingMs).toBeLessThanOrEqual(maxMs);
    });
  });

  // ── 2. Per-email signup / verification throttling ────────────────────────
  describe("per-email signup/verification throttling", () => {
    it("returns 429 for burst signups with the same email (works in test env)", async () => {
      const email = "burst-signup@example.com";
      trackEmail(email);
      const statuses = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request(app)
          .post("/api/auth/register")
          .send({
            name: `Burst ${i}`,
            email,
            password: "Qx7#vLmp92Zt",
            role: "student",
          });
        statuses.push(res.statusCode);
      }

      expect(statuses.slice(0, 3)).toEqual([201, 201, 201]);
      expect(statuses[3]).toBe(429);
    });

    it("returns 429 for burst verification resends with the same email", async () => {
      const email = "burst-resend@example.com";
      trackEmail(email);
      const pending = {
        _id: new mongoose.Types.ObjectId().toString(),
        email,
        name: "Resend",
        verificationToken: "initial-token",
      };
      pending.save = async function () { return this; };
      pendingStore.push(pending);

      const statuses = [];
      for (let i = 0; i < 4; i += 1) {
        const res = await request(app)
          .post("/api/auth/resend-verification")
          .send({ email });
        statuses.push(res.statusCode);
      }

      expect(statuses.slice(0, 3)).toEqual([200, 200, 200]);
      expect(statuses[3]).toBe(429);
    });
  });

  // ── 3. Captcha gate is a pluggable no-op when unconfigured ───────────────
  describe("captcha gate", () => {
    it("passes register requests when captcha is not configured", async () => {
      const email = "nocaptcha@example.com";
      trackEmail(email);
      const res = await request(app)
        .post("/api/auth/register")
        .send({
          name: "No Captcha",
          email,
          password: "Qx7#vLmp92Zt",
          captchaToken: "whatever-client-token",
        });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });
});