// test/breachedPassword.test.js
//
// Jest + supertest tests for the HaveIBeenPwned breached-password check
// (issue #89): rejects breached passwords at register AND reset, only sends
// the 5-char SHA-1 prefix, and fails OPEN on a HIBP outage.
//
// The HIBP range call is ALWAYS mocked — never hits the network in CI.
import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import axios from "axios";
import app from "../app.js";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Session from "../src/models/Session.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import { hashOtp } from "../src/utils/otp.js";

// A password that passes the static policy so ONLY the breach check decides.
const STRONG_PASSWORD = "Qx7#vLmp92Zt";
const SHA1 = crypto
  .createHash("sha1")
  .update(STRONG_PASSWORD)
  .digest("hex")
  .toUpperCase();
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

// HIBP range response listing our password as breached (suffix:count lines).
const BREACHED_BODY = `${SUFFIX}:873482\n0123ABCDEF:2\nFFFF0000AA:1`;

describe("Breached-password rejection (HIBP)", () => {
  let usersStore = [];
  let pendingStore = [];
  let auditStore = [];
  let getSpy;

  beforeAll(async () => {
    // Mock AuditLog.create so recordAudit writes into auditStore.
    jest.spyOn(AuditLog, "create").mockImplementation(async (data) => {
      const doc = { _id: new mongoose.Types.ObjectId().toString(), createdAt: new Date(), ...data };
      auditStore.push(doc);
      return doc;
    });

    // User mocks (login/reset read by email; register writes pending).
    jest.spyOn(User, "findOne").mockImplementation((query) => {
      const email = query?.email;
      const found = usersStore.find((u) => u.email === email);
      return { select: () => found || null, then: (resolve) => resolve(found || null) };
    });

    jest.spyOn(User, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const user = { _id, ...data, save: async function () { return this; } };
      usersStore.push(user);
      return user;
    });

    jest.spyOn(PendingUser, "findOneAndUpdate").mockImplementation(async (query, update) => {
      let pending = pendingStore.find((p) => p.email === query?.email);
      if (pending) Object.assign(pending, update);
      else pending = { _id: new mongoose.Types.ObjectId().toString(), ...update };
      pending.save = async function () { return this; };
      pendingStore.push(pending);
      return pending;
    });

    jest.spyOn(PendingUser, "findOne").mockImplementation(async (query) => {
      if (query?.email) return pendingStore.find((p) => p.email === query.email) || null;
      return null;
    });

    jest.spyOn(Session, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const session = { _id, ...data, save: async function () { return this; } };
      return session;
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    usersStore = [];
    pendingStore = [];
    auditStore = [];
    if (getSpy) getSpy.mockRestore();
  });

  // Default: mock the range GET as NOT breached (empty body). Accepts either a
  // response body string or a custom mock implementation (e.g. a rejection for
  // outage tests) so the suite's shared getSpy is always the spy that gets
  // restored by beforeEach.
  const mockHibp = (dataOrImpl) => {
    getSpy =
      typeof dataOrImpl === "function"
        ? jest.spyOn(axios, "get").mockImplementation(dataOrImpl)
        : jest
            .spyOn(axios, "get")
            .mockResolvedValue({ status: 200, statusText: "OK", data: dataOrImpl });
    return getSpy;
  };

  const flushAudit = () => new Promise((resolve) => setImmediate(resolve));

  describe("register", () => {
    it("rejects a known-breached password with 400 and audits the failure", async () => {
      mockHibp(BREACHED_BODY);
      const email = "breached-register@example.com";

      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Breached", email, password: STRONG_PASSWORD, role: "student" });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/breach/i);
      // No pending user was created.
      expect(pendingStore.find((p) => p.email === email)).toBeFalsy();

      await flushAudit();
      const row = auditStore.find((a) => a.action === AUDIT_ACTIONS.AUTH_REGISTER_FAILURE);
      expect(row).toBeDefined();
      expect(row.metadata?.reason).toBe("breached_password");
    });

    it("sends only the 5-char SHA-1 prefix — never the full hash or password", async () => {
      const getSpy = mockHibp(BREACHED_BODY);

      await request(app)
        .post("/api/auth/register")
        .send({ name: "Prefix", email: "prefix@example.com", password: STRONG_PASSWORD });

      const [url] = getSpy.mock.calls[0];
      expect(url).toContain(`/range/${PREFIX}`);
      expect(url).not.toContain(SHA1);
      expect(url).not.toContain(SUFFIX);
    });

    it("accepts a non-breached password", async () => {
      mockHibp(""); // no suffixes
      const email = "clean-register@example.com";

      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Clean", email, password: STRONG_PASSWORD, role: "student" });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("ignores HIBP padding records (count 0) and never treats them as a breach", async () => {
      // Add-Padding responses append fake suffixes with a 0 occurrence count;
      // even our own suffix must be ignored when its count is 0.
      mockHibp(`${SUFFIX}:0\n0123ABCDEF:2\nFFFF0000AA:1`);
      const email = "padding-register@example.com";

      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Padding", email, password: STRONG_PASSWORD, role: "student" });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it("fails OPEN (allows signup) when the HIBP API is down", async () => {
      mockHibp(() =>
        Promise.reject(new Error("ECONNREFUSED — HIBP outage"))
      );
      const email = "outage-register@example.com";

      const res = await request(app)
        .post("/api/auth/register")
        .send({ name: "Outage", email, password: STRONG_PASSWORD, role: "student" });

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
    });
  });

  describe("reset password", () => {
    it("rejects a known-breached new password at reset", async () => {
      const email = "breached-reset@example.com";
      const hashedPassword = await bcrypt.hash("oldPassword123", 4);
      const hashedOtp = await hashOtp("123456");
      const user = {
        _id: new mongoose.Types.ObjectId().toString(),
        name: "Reset",
        email,
        password: hashedPassword,
        role: "student",
        resetTokenHash: hashedOtp,
        resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
        save: async function () { return this; },
      };
      usersStore.push(user);

      mockHibp(BREACHED_BODY);

      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ email, otp: "123456", newPassword: STRONG_PASSWORD });

      expect(res.statusCode).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/breach/i);
    });

    it("accepts a non-breached new password at reset", async () => {
      const email = "clean-reset@example.com";
      const hashedPassword = await bcrypt.hash("oldPassword123", 4);
      const hashedOtp = await hashOtp("123456");
      const user = {
        _id: new mongoose.Types.ObjectId().toString(),
        name: "Reset",
        email,
        password: hashedPassword,
        role: "student",
        resetTokenHash: hashedOtp,
        resetTokenExpiry: new Date(Date.now() + 15 * 60 * 1000),
        save: async function () { return this; },
      };
      usersStore.push(user);

      mockHibp(""); // not breached

      const res = await request(app)
        .post("/api/auth/reset-password")
        .send({ email, otp: "123456", newPassword: STRONG_PASSWORD });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });
});