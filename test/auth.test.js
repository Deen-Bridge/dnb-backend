import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import crypto from "crypto";
import axios from "axios";
import app from "../app.js";
import User from "../src/models/User.js";
import Session from "../src/models/Session.js";
import PendingUser from "../src/models/PendingUser.js";

const testUser = {
  name: "Test Rotation User",
  email: "test_rotation@example.com",
  password: "Qx7#vLmp92Zt",
  role: "student",
};

describe("Authentication & Session Management", () => {
  let usersStore = [];
  let sessionsStore = [];
  let pendingStore = [];

  beforeAll(() => {
    // Mock axios to prevent network calls during tests
    jest.spyOn(axios, "post").mockResolvedValue({ status: 200, statusText: "OK", data: {} });
    // Mock the HIBP breached-password range call (empty data => not breached).
    jest.spyOn(axios, "get").mockResolvedValue({ status: 200, statusText: "OK", data: "" });

    // Mock User methods
    jest.spyOn(User, "findOne").mockImplementation((query) => {
      const email = query?.email;
      const found = usersStore.find((u) => u.email === email);
      return {
        select: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(User, "findById").mockImplementation((id) => {
      const found = usersStore.find((u) => u._id.toString() === id.toString());
      return {
        select: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(User, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const newUser = {
        _id,
        ...data,
        save: async function () { return this; },
      };
      usersStore.push(newUser);
      return newUser;
    });

    jest.spyOn(User, "deleteMany").mockImplementation(async () => {
      usersStore = [];
      return { acknowledged: true };
    });

    // PendingUser powers the email-verification-first register flow:
    // register() upserts a pending record; verifyEmail() reads it by token.
    jest.spyOn(PendingUser, "findOneAndUpdate").mockImplementation(
      async (query, update) => {
        let pending = pendingStore.find((p) => p.email === query?.email);
        if (pending) {
          Object.assign(pending, update);
        } else {
          pending = { _id: new mongoose.Types.ObjectId().toString(), ...update };
          pendingStore.push(pending);
        }
        return pending;
      }
    );

    jest.spyOn(PendingUser, "findOne").mockImplementation(async (query) => {
      if (query?.verificationToken) {
        return (
          pendingStore.find(
            (p) => p.verificationToken === query.verificationToken
          ) || null
        );
      }
      if (query?.email) {
        return pendingStore.find((p) => p.email === query.email) || null;
      }
      return null;
    });

    jest.spyOn(PendingUser, "deleteOne").mockImplementation(async (query) => {
      pendingStore = pendingStore.filter(
        (p) => p._id !== query?._id && p.email !== query?.email
      );
      return { deletedCount: 1 };
    });

    // Mock Session methods
    jest.spyOn(Session, "create").mockImplementation(async (data) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const newSession = {
        _id,
        revokedAt: null,
        replacedBy: null,
        lastUsedAt: new Date(),
        ...data,
        save: async function () { return this; },
      };
      sessionsStore.push(newSession);
      return newSession;
    });

    jest.spyOn(Session, "findOne").mockImplementation((query) => {
      let found = null;
      if (query.refreshTokenHash) {
        found = sessionsStore.find((s) => s.refreshTokenHash === query.refreshTokenHash);
      } else if (query._id) {
        found = sessionsStore.find((s) => s._id.toString() === query._id.toString() && (!query.user || s.user.toString() === query.user.toString()));
      }
      return {
        populate: (field) => {
          if (!found) return null;
          const userObj = usersStore.find((u) => u._id.toString() === (found.user._id || found.user).toString());
          if (userObj) {
            found.user = userObj;
          }
          return found;
        },
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(Session, "find").mockImplementation((query) => {
      let results = sessionsStore;
      if (query.user) {
        results = results.filter((s) => (s.user._id || s.user).toString() === query.user.toString());
      }
      if (query.revokedAt === null) {
        results = results.filter((s) => s.revokedAt === null);
      }
      if (query.family) {
        results = results.filter((s) => s.family === query.family);
      }
      if (query.expiresAt && query.expiresAt.$gt) {
        results = results.filter((s) => new Date(s.expiresAt) > query.expiresAt.$gt);
      }
      return results;
    });

    jest.spyOn(Session, "updateOne").mockImplementation(async (query, update) => {
      let found = null;
      if (query.refreshTokenHash) {
        found = sessionsStore.find((s) => s.refreshTokenHash === query.refreshTokenHash);
      } else if (query._id) {
        found = sessionsStore.find((s) => s._id.toString() === query._id.toString());
      }
      if (found) {
        const fields = update.$set ? update.$set : update;
        Object.assign(found, fields);
      }
      return { acknowledged: true };
    });

    jest.spyOn(Session, "updateMany").mockImplementation(async (query, update) => {
      let matches = sessionsStore;
      if (query.family) {
        matches = matches.filter((s) => s.family === query.family);
      }
      if (query.user) {
        matches = matches.filter((s) => s.user.toString() === query.user.toString());
      }
      if (query._id && query._id.$ne) {
        matches = matches.filter((s) => s._id.toString() !== query._id.$ne.toString());
      }
      if (query.revokedAt === null) {
        matches = matches.filter((s) => s.revokedAt === null);
      }
      if (update.$set) {
        matches.forEach((s) => Object.assign(s, update.$set));
      }
      return { acknowledged: true };
    });

    jest.spyOn(Session, "deleteMany").mockImplementation(async () => {
      sessionsStore = [];
      return { acknowledged: true };
    });
  });

  beforeEach(() => {
    usersStore = [];
    sessionsStore = [];
    pendingStore = [];
  });

  // Register no longer logs a user in directly — it creates a pending record and
  // sends a verification email. This helper runs the real two-step flow
  // (register -> verify-email) and returns the verify response, which carries the
  // access/refresh tokens and the refresh cookie, so downstream tests that need a
  // logged-in user keep working.
  async function registerAndVerify(user = testUser) {
    await request(app).post("/api/auth/register").send(user);
    const pending = pendingStore.find((p) => p.email === user.email);
    return request(app).get(`/api/auth/verify-email/${pending.verificationToken}`);
  }

  afterAll(() => {
    jest.restoreAllMocks();
  });

  describe("Register & Login", () => {
    it("should create a pending user and require email verification on register", async () => {
      const res = await request(app)
        .post("/api/auth/register")
        .send(testUser);

      expect(res.statusCode).toBe(201);
      expect(res.body.success).toBe(true);
      // No tokens yet — the account is not active until the email is verified.
      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.refreshToken).toBeUndefined();
      // A pending record was created for this email.
      expect(
        pendingStore.find((p) => p.email === testUser.email)
      ).toBeTruthy();
    });

    it("should return 503 (not 500) and roll back the pending record when the verification email fails", async () => {
      // Force sendVerificationEmail to throw by pointing SendLib at a closed port.
      process.env.SENDLIB_API_URL = "http://127.0.0.1:2526";
      process.env.SENDLIB_API_KEY = "invalid_test_key";
      try {
        const res = await request(app)
          .post("/api/auth/register")
          .send(testUser);

        expect(res.statusCode).toBe(503);
        expect(res.body.success).toBe(false);
        // Pending record rolled back so the user can retry cleanly.
        expect(
          pendingStore.find((p) => p.email === testUser.email)
        ).toBeFalsy();
      } finally {
        delete process.env.SENDLIB_API_URL;
        delete process.env.SENDLIB_API_KEY;
      }
    });

    it("should return access token, refresh token, and cookie after email verification", async () => {
      const res = await registerAndVerify(testUser);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body).toHaveProperty("token"); // legacy
      expect(res.body.user.email).toBe(testUser.email);

      // Verify cookie
      const cookies = res.headers["set-cookie"];
      expect(cookies).toBeDefined();
      const refreshCookie = cookies.find((c) => c.includes("refreshToken"));
      expect(refreshCookie).toBeDefined();
      expect(refreshCookie).toContain("HttpOnly");
      expect(refreshCookie).toContain("Path=/api/auth/refresh");
    });

    it("should return access token, refresh token, and cookie on login", async () => {
      // Register + verify first so the account exists.
      await registerAndVerify(testUser);

      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: testUser.email,
          password: testUser.password,
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty("accessToken");
      expect(res.body).toHaveProperty("refreshToken");
      expect(res.body).toHaveProperty("token");
    });
  });

  describe("Refresh Token Rotation", () => {
    it("should rotate refresh and access tokens via body mode", async () => {
      // Register
      const regRes = await registerAndVerify(testUser);
      const firstRefreshToken = regRes.body.refreshToken;

      // Refresh
      const refRes = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: firstRefreshToken });

      expect(refRes.statusCode).toBe(200);
      expect(refRes.body).toHaveProperty("accessToken");
      expect(refRes.body).toHaveProperty("refreshToken");
      expect(refRes.body.refreshToken).not.toBe(firstRefreshToken);

      // Verify old token is revoked/replaced in DB
      const oldHash = crypto.createHash("sha256").update(firstRefreshToken).digest("hex");
      const oldSession = await Session.findOne({ refreshTokenHash: oldHash });
      expect(oldSession.revokedAt).not.toBeNull();
      expect(oldSession.replacedBy).toBeDefined();
    });

    it("should rotate tokens via cookie mode", async () => {
      const regRes = await registerAndVerify(testUser);
      const cookies = regRes.headers["set-cookie"];
      const refreshCookie = cookies.find((c) => c.startsWith("refreshToken="));

      const refRes = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", [refreshCookie]);

      expect(refRes.statusCode).toBe(200);
      expect(refRes.body).toHaveProperty("accessToken");
      expect(refRes.body).toHaveProperty("refreshToken");
    });

    it("should detect token reuse and revoke the entire family", async () => {
      const regRes = await registerAndVerify(testUser);
      const firstRefreshToken = regRes.body.refreshToken;

      // First refresh (honest rotation)
      const refRes1 = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: firstRefreshToken });
      
      const secondRefreshToken = refRes1.body.refreshToken;

      // Second refresh using the ALREADY rotated firstRefreshToken (reuse event!)
      const reuseRes = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: firstRefreshToken });

      expect(reuseRes.statusCode).toBe(401);

      // Subsequent refresh with the legitimate secondRefreshToken should also fail
      const nextRes = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken: secondRefreshToken });

      expect(nextRes.statusCode).toBe(401);

      // Verify all sessions in family are revoked in DB
      const oldHash = crypto.createHash("sha256").update(firstRefreshToken).digest("hex");
      const oldSession = await Session.findOne({ refreshTokenHash: oldHash });
      const sessions = await Session.find({ family: oldSession.family });
      sessions.forEach((s) => {
        expect(s.revokedAt).not.toBeNull();
      });
    });

    it("should return 401 for expired tokens without revoking family", async () => {
      const regRes = await registerAndVerify(testUser);
      const refreshToken = regRes.body.refreshToken;

      // Manually expire session in DB
      const hash = crypto.createHash("sha256").update(refreshToken).digest("hex");
      await Session.updateOne({ refreshTokenHash: hash }, { expiresAt: new Date(Date.now() - 1000) });

      const refRes = await request(app)
        .post("/api/auth/refresh")
        .send({ refreshToken });

      expect(refRes.statusCode).toBe(401);
      
      // Verify session was not revoked (expired-but-honest)
      const session = await Session.findOne({ refreshTokenHash: hash });
      expect(session.revokedAt).toBeNull();
    });
  });

  describe("Session Management", () => {
    it("should list active sessions and mark current", async () => {
      const loginRes = await registerAndVerify(testUser);
      const accessToken = loginRes.body.accessToken;

      const sessionsRes = await request(app)
        .get("/api/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(sessionsRes.statusCode).toBe(200);
      expect(sessionsRes.body.sessions.length).toBe(1);
      expect(sessionsRes.body.sessions[0].isCurrent).toBe(true);
      expect(sessionsRes.body.sessions[0].device).toHaveProperty("userAgent");
    });

    it("should revoke a single session", async () => {
      const regRes = await registerAndVerify(testUser);
      const accessToken = regRes.body.accessToken;

      // Create another session by logging in again
      await request(app)
        .post("/api/auth/login")
        .send({ email: testUser.email, password: testUser.password });

      const sessionsRes = await request(app)
        .get("/api/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`);
      
      const otherSessionId = sessionsRes.body.sessions.find((s) => !s.isCurrent).id;

      // Revoke the other session
      const revokeRes = await request(app)
        .delete(`/api/auth/sessions/${otherSessionId}`)
        .set("Authorization", `Bearer ${accessToken}`);

      expect(revokeRes.statusCode).toBe(200);

      // Verify only current session is active
      const activeSessions = await Session.find({ user: regRes.body.user.id, revokedAt: null });
      expect(activeSessions.length).toBe(1);
    });

    it("should revoke all other sessions", async () => {
      const regRes = await registerAndVerify(testUser);
      const accessToken = regRes.body.accessToken;

      // Login multiple times
      await request(app).post("/api/auth/login").send({ email: testUser.email, password: testUser.password });
      await request(app).post("/api/auth/login").send({ email: testUser.email, password: testUser.password });

      const revokeOthersRes = await request(app)
        .delete("/api/auth/sessions")
        .set("Authorization", `Bearer ${accessToken}`);

      expect(revokeOthersRes.statusCode).toBe(200);

      // Verify only caller session remains unrevoked
      const activeSessions = await Session.find({ user: regRes.body.user.id, revokedAt: null });
      expect(activeSessions.length).toBe(1);
    });

    it("should logout successfully and revoke session", async () => {
      const regRes = await registerAndVerify(testUser);
      const { accessToken, refreshToken } = regRes.body;

      const logoutRes = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${accessToken}`)
        .send({ refreshToken });

      expect(logoutRes.statusCode).toBe(200);

      // Verify session is revoked
      const activeSessions = await Session.find({ user: regRes.body.user.id, revokedAt: null });
      expect(activeSessions.length).toBe(0);
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });
});
