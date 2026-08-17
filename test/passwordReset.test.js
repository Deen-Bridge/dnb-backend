import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import app from "../app.js";
import User from "../src/models/User.js";
import PendingUser from "../src/models/PendingUser.js";
import Session from "../src/models/Session.js";
import logger from "../src/config/logger.js";

const testUser = {
  name: "Reset User",
  email: "reset_user@example.com",
  password: "oldPassword123",
  role: "student",
};

describe("Password Reset Flow", () => {
  jest.setTimeout(30000);

  let usersStore = [];
  let sessionsStore = [];
  let loggerInfoSpy;

  beforeAll(() => {
    // Capture the OTP code from the [EMAIL LOG] fallback (SMTP is unset in tests)
    loggerInfoSpy = jest.spyOn(logger, "info");

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

    // Registration stores a pending user awaiting email verification
    jest.spyOn(PendingUser, "findOneAndUpdate").mockImplementation(async (query, update) => {
      const _id = new mongoose.Types.ObjectId().toString();
      const newUser = {
        _id,
        ...update,
        save: async function () { return this; },
      };
      usersStore.push(newUser);
      return newUser;
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
        found = sessionsStore.find((s) => s._id.toString() === query._id.toString());
      }
      return {
        populate: () => found || null,
        then: (resolve) => resolve(found || null),
      };
    });
  });

  beforeEach(() => {
    usersStore = [];
    sessionsStore = [];
    if (loggerInfoSpy) loggerInfoSpy.mockClear();
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  const getSentOtp = () => {
    // Registration now also sends a verification email, so multiple [EMAIL LOG]
    // entries exist. Pick the most recent one that actually carries an OTP span.
    const otpLog = loggerInfoSpy.mock.calls
      .map((call) => call[0])
      .filter((msg) => typeof msg === "string" && msg.includes("[EMAIL LOG]"))
      .reverse()
      .find((msg) => /#166534;">(\d+)<\/span>/.test(msg));
    const match = otpLog && otpLog.match(/#166534;">(\d+)<\/span>/);
    return match ? match[1] : null;
  };

  it("should request password reset without exposing OTP in response body and include success: true", async () => {
    await request(app).post("/api/auth/register").send(testUser);

    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("If an account exists");
    expect(res.body).not.toHaveProperty("otp");

    const sentOtp = getSentOtp();
    expect(sentOtp).toBeDefined();
    expect(typeof sentOtp).toBe("string");

    // Verify resetTokenHash and resetTokenExpiry stored on user
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    expect(dbUser.resetTokenHash).toBeDefined();
    expect(dbUser.resetTokenExpiry).toBeDefined();
  });

  it("should return generic message when requesting reset for non-existent email (anti-enumeration)", async () => {
    const res = await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: "nonexistent@example.com" });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("If an account exists");
    expect(res.body).not.toHaveProperty("otp");
  });

  it("should handle sendMail delivery failure by rolling back token fields and returning generic 200 (anti-enumeration)", async () => {
    await request(app).post("/api/auth/register").send(testUser);

    // Force the OTP email to fail: point SendLib at a closed local port so the
    // connection is refused and sendOtpEmail throws.
    process.env.SENDLIB_API_URL = "http://127.0.0.1:2525";
    process.env.SENDLIB_API_KEY = "invalid_test_key";
    try {
      const res = await request(app)
        .post("/api/auth/request-password-reset")
        .send({ email: testUser.email });

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("If an account exists");
    } finally {
      delete process.env.SENDLIB_API_URL;
      delete process.env.SENDLIB_API_KEY;
    }

    // Token fields should be rolled back to undefined so orphaned tokens aren't left active
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    expect(dbUser.resetTokenHash).toBeUndefined();
    expect(dbUser.resetTokenExpiry).toBeUndefined();
  });

  it("should reject password reset with wrong OTP and return success: false", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: "000000",
        newPassword: "newSecurePassword123",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Invalid or expired OTP");
  });

  it("should reject password reset with expired OTP", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const sentOtp = getSentOtp();
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    // Artificially expire the token
    dbUser.resetTokenExpiry = new Date(Date.now() - 1000);

    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword: "newSecurePassword123",
      });

    expect(res.statusCode).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain("Invalid or expired OTP");
  });

  it("should successfully reset password with valid OTP and clear token (single use)", async () => {
    await request(app).post("/api/auth/register").send(testUser);
    await request(app)
      .post("/api/auth/request-password-reset")
      .send({ email: testUser.email });

    const sentOtp = getSentOtp();
    const newPassword = "newSecurePassword123";

    // Successful reset
    const res = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword,
      });

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toContain("Password reset successful");

    // Token fields cleared from user
    const dbUser = usersStore.find((u) => u.email === testUser.email);
    expect(dbUser.resetTokenHash).toBeUndefined();
    expect(dbUser.resetTokenExpiry).toBeUndefined();

    // Verify bcrypt cost factor 12 was used
    const passwordHash = dbUser.password;
    expect(passwordHash.startsWith("$2b$12$") || passwordHash.startsWith("$2a$12$")).toBe(true);

    // Verify user can now login with new password
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: testUser.email, password: newPassword });

    expect(loginRes.statusCode).toBe(200);
    expect(loginRes.body.success).toBe(true);

    // Reused OTP attempt should be rejected
    const reuseRes = await request(app)
      .post("/api/auth/reset-password")
      .send({
        email: testUser.email,
        otp: sentOtp,
        newPassword: "anotherPassword123",
      });

    expect(reuseRes.statusCode).toBe(400);
    expect(reuseRes.body.success).toBe(false);
    expect(reuseRes.body.message).toContain("Invalid or expired OTP");
  });
});
