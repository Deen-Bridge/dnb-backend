import { jest } from "@jest/globals";
import request from "supertest";
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import bcrypt from "bcrypt";
import app from "../app.js";
import User from "../src/models/User.js";
import Session from "../src/models/Session.js";
import AuditLog, { AUDIT_ACTIONS } from "../src/models/AuditLog.js";
import {
  encryptSecret,
  decryptSecret,
  generateBase32Secret,
  generateTOTPCode,
} from "../src/utils/twoFactorCrypto.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

describe("TOTP Two-Factor Authentication (2FA)", () => {
  let usersStore = [];
  let sessionsStore = [];
  let auditStore = [];

  const makeUser = (overrides = {}) => {
    const _id = new mongoose.Types.ObjectId().toString();
    const userDoc = {
      _id,
      name: "Test 2FA User",
      email: `user_${_id}@example.com`,
      password: "", // set in test
      role: "mentor",
      isVerified: true,
      twoFactor: {
        enabled: false,
        secret: undefined,
        pendingSecret: undefined,
        recoveryCodes: [],
        enrolledAt: undefined,
      },
      save: async function () {
        const idx = usersStore.findIndex((u) => u._id.toString() === this._id.toString());
        if (idx >= 0) usersStore[idx] = this;
        else usersStore.push(this);
        return this;
      },
      ...overrides,
    };
    return userDoc;
  };

  const mintToken = (user, is2FAVerified = false) =>
    jwt.sign(
      { userId: user._id, role: user.role, sessionId: "sess-1", is2FAVerified },
      JWT_SECRET,
      { expiresIn: "15m" }
    );

  beforeAll(() => {
    // ── AuditLog mocks ──────────────────────────────────────────────────────
    jest.spyOn(AuditLog, "create").mockImplementation(async (data) => {
      const doc = {
        _id: new mongoose.Types.ObjectId().toString(),
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
        return true;
      });
      return {
        sort: function () { return this; },
        skip: function (n) { return this; },
        limit: function (n) { return this; },
        populate: function () { return this; },
        lean: async function () { return filtered; },
        then: (resolve) => resolve(filtered),
      };
    });

    jest.spyOn(AuditLog, "countDocuments").mockImplementation(async () => auditStore.length);

    // ── User mocks ──────────────────────────────────────────────────────────
    jest.spyOn(User, "findOne").mockImplementation((query) => {
      const email = query?.email;
      const found = usersStore.find((u) => u.email === email);
      return {
        select: (fields) => {
          // If select(+password) or select(+twoFactor.secret) is called
          return found || null;
        },
        then: (resolve) => resolve(found || null),
      };
    });

    jest.spyOn(User, "findById").mockImplementation((id) => {
      const found = usersStore.find((u) => u._id.toString() === id.toString());
      return {
        select: (fields) => found || null,
        then: (resolve) => resolve(found || null),
      };
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

    // ── Session mocks ───────────────────────────────────────────────────────
    jest.spyOn(Session, "create").mockImplementation(async (data) => {
      const sess = {
        _id: new mongoose.Types.ObjectId().toString(),
        revokedAt: null,
        replacedBy: null,
        lastUsedAt: new Date(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
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
        found = sessionsStore.find((s) => s._id.toString() === query._id.toString());
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
      return results;
    });

    jest.spyOn(Session, "deleteMany").mockImplementation(async () => {
      sessionsStore = [];
      return { acknowledged: true };
    });
  });

  beforeEach(() => {
    usersStore = [];
    sessionsStore = [];
    auditStore = [];
    delete process.env.ENABLE_TEST_RATE_LIMIT;
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. ADMIN 2FA ENFORCEMENT
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Admin 2FA Enforcement", () => {
    it("rejects admin actions with 403 when admin has NOT enabled 2FA", async () => {
      const adminNo2FA = makeUser({
        name: "Admin No 2FA",
        email: "admin_no_2fa@example.com",
        role: "admin",
        twoFactor: { enabled: false },
      });
      usersStore.push(adminNo2FA);
      const token = mintToken(adminNo2FA, false);

      const res = await request(app)
        .get("/api/admin/audit")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain("Admin access requires TOTP two-factor authentication to be enabled");
    });

    it("rejects admin actions with 403 when admin token is NOT 2FA-verified", async () => {
      const adminWith2FA = makeUser({
        name: "Admin With 2FA",
        email: "admin_with_2fa@example.com",
        role: "admin",
        twoFactor: { enabled: true, secret: encryptSecret(generateBase32Secret()) },
      });
      usersStore.push(adminWith2FA);
      // Mint token without is2FAVerified claim (e.g. single factor session)
      const token = mintToken(adminWith2FA, false);

      const res = await request(app)
        .get("/api/admin/audit")
        .set("Authorization", `Bearer ${token}`);

      expect(res.statusCode).toBe(403);
      expect(res.body.message).toContain("Admin access requires a 2FA-verified session");
    });

    it("allows admin actions when admin has 2FA enabled AND token is 2FA-verified", async () => {
      const adminWith2FA = makeUser({
        name: "Admin Verified",
        email: "admin_verified@example.com",
        role: "admin",
        twoFactor: { enabled: true, secret: encryptSecret(generateBase32Secret()) },
      });
      usersStore.push(adminWith2FA);
      const verifiedToken = mintToken(adminWith2FA, true);

      const res = await request(app)
        .get("/api/admin/audit")
        .set("Authorization", `Bearer ${verifiedToken}`);

      expect(res.statusCode).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 2. ENROLL -> CONFIRM -> LOGIN ROUND-TRIP
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Enrollment, Confirmation & Step-up Login Flow", () => {
    it("completes full 2FA lifecycle (setup -> confirm -> step-up login)", async () => {
      const plainPassword = "Qx7#vLmp92Zt";
      const hashedPassword = await bcrypt.hash(plainPassword, 12);
      const user = makeUser({
        email: "mentor_2fa@example.com",
        password: hashedPassword,
        role: "mentor",
      });
      usersStore.push(user);
      const initialToken = mintToken(user, false);

      // ── Step 1: POST /api/auth/2fa/setup ────────────────────────────────────
      const setupRes = await request(app)
        .post("/api/auth/2fa/setup")
        .set("Authorization", `Bearer ${initialToken}`);

      expect(setupRes.statusCode).toBe(200);
      expect(setupRes.body.success).toBe(true);
      expect(setupRes.body.secret).toBeDefined();
      expect(setupRes.body.otpauthUrl).toContain("otpauth://totp/");
      expect(setupRes.body.qrCode).toContain("data:image/png;base64,");

      const plainSecret = setupRes.body.secret;
      expect(user.twoFactor.enabled).toBe(false);
      expect(user.twoFactor.pendingSecret).toBeDefined();

      // Check setup initiated audit log
      await new Promise((r) => setImmediate(r));
      const setupAudit = auditStore.find((a) => a.action === AUDIT_ACTIONS.AUTH_2FA_SETUP_INITIATED);
      expect(setupAudit).toBeDefined();

      // ── Step 2: POST /api/auth/2fa/verify (Confirm Setup with wrong code) ───
      const wrongConfirmRes = await request(app)
        .post("/api/auth/2fa/verify")
        .set("Authorization", `Bearer ${initialToken}`)
        .send({ code: "000000" });

      expect(wrongConfirmRes.statusCode).toBe(401);
      expect(user.twoFactor.enabled).toBe(false);

      // ── Step 3: POST /api/auth/2fa/verify (Confirm Setup with valid code) ────
      const validSetupCode = generateTOTPCode(plainSecret);

      const confirmRes = await request(app)
        .post("/api/auth/2fa/verify")
        .set("Authorization", `Bearer ${initialToken}`)
        .send({ code: validSetupCode });

      expect(confirmRes.statusCode).toBe(200);
      expect(confirmRes.body.success).toBe(true);
      expect(confirmRes.body.recoveryCodes).toBeDefined();
      expect(confirmRes.body.recoveryCodes.length).toBe(10);
      expect(user.twoFactor.enabled).toBe(true);
      expect(user.twoFactor.pendingSecret).toBeUndefined();

      const recoveryCodes = confirmRes.body.recoveryCodes;

      // ── Step 4: POST /api/auth/login (First Factor Password Check) ───────────
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: plainPassword });

      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.body.mfaRequired).toBe(true);
      expect(loginRes.body.mfaToken).toBeDefined();
      // Ensure NO access or refresh tokens in password-only response!
      expect(loginRes.body.accessToken).toBeUndefined();
      expect(loginRes.body.refreshToken).toBeUndefined();
      expect(loginRes.body.token).toBeUndefined();

      const mfaToken = loginRes.body.mfaToken;

      // ── Step 5: POST /api/auth/2fa/verify (Login Step-up with invalid code) ──
      const badMfaRes = await request(app)
        .post("/api/auth/2fa/verify")
        .send({ mfaToken, code: "999999" });

      expect(badMfaRes.statusCode).toBe(401);

      // ── Step 6: POST /api/auth/2fa/verify (Login Step-up with valid code) ───
      const validLoginCode = generateTOTPCode(plainSecret);

      const mfaSuccessRes = await request(app)
        .post("/api/auth/2fa/verify")
        .send({ mfaToken, code: validLoginCode });

      expect(mfaSuccessRes.statusCode).toBe(200);
      expect(mfaSuccessRes.body.success).toBe(true);
      expect(mfaSuccessRes.body.accessToken).toBeDefined();
      expect(mfaSuccessRes.body.refreshToken).toBeDefined();

      // Verify the issued JWT access token has is2FAVerified: true
      const decodedAccess = jwt.verify(mfaSuccessRes.body.accessToken, JWT_SECRET);
      expect(decodedAccess.is2FAVerified).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. SINGLE-USE RECOVERY CODES
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Single-Use Recovery Codes", () => {
    it("allows login via recovery code and burns the used code immediately", async () => {
      const plainPassword = "Qx7#vLmp92Zt";
      const hashedPassword = await bcrypt.hash(plainPassword, 12);
      const secret = generateBase32Secret();

      // Generate hashed recovery codes
      const rawCode = "A1B2-C3D4-E5F6";
      const hashedCode = await bcrypt.hash(rawCode, 10);

      const user = makeUser({
        email: "recovery_user@example.com",
        password: hashedPassword,
        role: "mentor",
        twoFactor: {
          enabled: true,
          secret: encryptSecret(secret),
          recoveryCodes: [hashedCode],
          enrolledAt: new Date(),
        },
      });
      usersStore.push(user);

      // 1. Password check
      const loginRes = await request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: plainPassword });

      expect(loginRes.body.mfaRequired).toBe(true);
      const mfaToken1 = loginRes.body.mfaToken;

      // 2. Submit recovery code for second factor
      const mfaRes1 = await request(app)
        .post("/api/auth/2fa/verify")
        .send({ mfaToken: mfaToken1, recoveryCode: rawCode });

      expect(mfaRes1.statusCode).toBe(200);
      expect(mfaRes1.body.accessToken).toBeDefined();

      // Verify the code was burned (removed from user.twoFactor.recoveryCodes)
      expect(user.twoFactor.recoveryCodes.length).toBe(0);

      // 3. Attempt to reuse the SAME recovery code on a new login attempt
      const loginRes2 = await request(app)
        .post("/api/auth/login")
        .send({ email: user.email, password: plainPassword });

      const mfaToken2 = loginRes2.body.mfaToken;

      const mfaRes2 = await request(app)
        .post("/api/auth/2fa/verify")
        .send({ mfaToken: mfaToken2, recoveryCode: rawCode });

      expect(mfaRes2.statusCode).toBe(401);
      expect(mfaRes2.body.message).toContain("Invalid 2FA code or recovery code");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 4. SECRET & RECOVERY CODE SERIALIZATION EXCLUSION
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Secret & Recovery Code Privacy", () => {
    it("never serializes secret or recovery code hashes in user responses", async () => {
      const secret = generateBase32Secret();
      const user = makeUser({
        email: "privacy_user@example.com",
        role: "student",
        twoFactor: {
          enabled: true,
          secret: encryptSecret(secret),
          recoveryCodes: ["$2b$10$hashedrecoverycode"],
        },
      });
      usersStore.push(user);

      const token = mintToken(user, true);

      // Check logout/user responses
      const userRes = await request(app)
        .get("/api/auth/sessions")
        .set("Authorization", `Bearer ${token}`);

      const jsonStr = JSON.stringify(userRes.body);
      expect(jsonStr).not.toContain("twoFactor");
      expect(jsonStr).not.toContain("secret");
      expect(jsonStr).not.toContain("recoveryCodes");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5. RATE LIMITING
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Rate Limiting on 2FA Verification", () => {
    it("throttles repeated invalid verify requests to 429 when enabled", async () => {
      process.env.ENABLE_TEST_RATE_LIMIT = "true";

      const user = makeUser({ email: "ratelimit_user@example.com" });
      usersStore.push(user);
      const token = mintToken(user, false);

      let lastStatus = 0;
      for (let i = 0; i < 6; i++) {
        const res = await request(app)
          .post("/api/auth/2fa/verify")
          .set("Authorization", `Bearer ${token}`)
          .send({ code: "000000" });
        lastStatus = res.statusCode;
      }

      expect(lastStatus).toBe(429);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 6. DISABLE 2FA
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Disable 2FA", () => {
    it("requires a valid code to disable 2FA", async () => {
      const secret = generateBase32Secret();
      const user = makeUser({
        email: "disable_user@example.com",
        role: "mentor",
        twoFactor: {
          enabled: true,
          secret: encryptSecret(secret),
          enrolledAt: new Date(),
        },
      });
      usersStore.push(user);

      const token = mintToken(user, true);

      // Invalid code -> 401
      const badDisableRes = await request(app)
        .post("/api/auth/2fa/disable")
        .set("Authorization", `Bearer ${token}`)
        .send({ code: "111111" });

      expect(badDisableRes.statusCode).toBe(401);
      expect(user.twoFactor.enabled).toBe(true);

      // Valid code -> 200
      const validCode = generateTOTPCode(secret);

      const validDisableRes = await request(app)
        .post("/api/auth/2fa/disable")
        .set("Authorization", `Bearer ${token}`)
        .send({ code: validCode });

      expect(validDisableRes.statusCode).toBe(200);
      expect(user.twoFactor.enabled).toBe(false);
      expect(user.twoFactor.secret).toBeUndefined();
    });
  });
});
