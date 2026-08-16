// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import PendingUser from "../models/PendingUser.js";
import Session from "../models/Session.js";
import { sendOtpEmail, sendVerificationEmail } from "../../services/emails/sendMail.js";
import logger from "../config/logger.js";
import { enqueue } from "../jobs/queue.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import { generateOtp, hashOtp, verifyOtp } from "../utils/otp.js";
import { firstPasswordIssue } from "../utils/passwordPolicy.js";
import { isPasswordBreached } from "../utils/hibp.js";

import { catchAsync, APIError } from "../middlewares/errorHandler.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

// ── Progressive login lockout (issue #89) ───────────────────────────────────
// After LOGIN_MAX_FAILED_ATTEMPTS consecutive failures, the account is locked
// for an escalating duration. Each new failure while unlocked (re)extends the
// lock with exponential backoff, capped at LOGIN_LOCKOUT_MAX_MS.
const LOGIN_MAX_FAILED_ATTEMPTS =
  parseInt(process.env.LOGIN_MAX_ATTEMPTS, 10) || 5;
const LOGIN_LOCKOUT_BASE_MS =
  parseInt(process.env.LOGIN_LOCKOUT_BASE_MS, 10) || 60 * 1000; // 1 min
const LOGIN_LOCKOUT_MAX_MS =
  parseInt(process.env.LOGIN_LOCKOUT_MAX_MS, 10) || 24 * 60 * 60 * 1000; // 24 h
const LOGIN_LOCKOUT_MULTIPLIER = 2;

/** Escalating backoff: base * 2^(failures - threshold), capped at the max. */
const lockoutDurationMs = (failedAttempts) =>
  Math.min(
    LOGIN_LOCKOUT_MAX_MS,
    LOGIN_LOCKOUT_BASE_MS *
      LOGIN_LOCKOUT_MULTIPLIER **
        Math.max(0, failedAttempts - LOGIN_MAX_FAILED_ATTEMPTS)
  );

// Log JWT configuration on startup and warn if using fallback
if (!process.env.JWT_SECRET) {
  logger.warn(
    "⚠️ WARNING: JWT_SECRET not found in .env! Using fallback (INSECURE for production)"
  );
} else {
  logger.info(
    `✅ JWT_SECRET loaded from .env (length: ${process.env.JWT_SECRET.length})`
  );
}

// Helper: parse duration string to ms (e.g. 15m, 30d)
export const parseDurationToMs = (duration) => {
  const match = duration.match(/^(\d+)([smhd])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000; // default 30 days
  const value = parseInt(match[1], 10);
  const unit = match[2];
  switch (unit) {
    case "s": return value * 1000;
    case "m": return value * 60 * 1000;
    case "h": return value * 60 * 60 * 1000;
    case "d": return value * 24 * 60 * 60 * 1000;
    default: return value * 24 * 60 * 60 * 1000;
  }
};

// Helper: get device label from user agent
const getDeviceLabel = (userAgent) => {
  if (!userAgent) return "Unknown Device";
  let os = "Unknown OS";
  if (userAgent.includes("Windows")) os = "Windows";
  else if (userAgent.includes("Macintosh") || userAgent.includes("Mac OS")) os = "macOS";
  else if (userAgent.includes("Linux")) os = "Linux";
  else if (userAgent.includes("Android")) os = "Android";
  else if (userAgent.includes("iPhone") || userAgent.includes("iPad")) os = "iOS";

  let browser = "Unknown Browser";
  if (userAgent.includes("Firefox")) browser = "Firefox";
  else if (userAgent.includes("Chrome")) browser = "Chrome";
  else if (userAgent.includes("Safari")) browser = "Safari";
  else if (userAgent.includes("Edge")) browser = "Edge";
  else if (userAgent.includes("Opera")) browser = "Opera";

  return `${browser} on ${os}`;
};

// Helper: shape the public user object returned by every auth response.
// Kept in one place so email login, register, and Stellar login stay identical.
export const shapeAuthUser = (user) => ({
  id: user._id,
  name: user.name,
  role: user.role,
  email: user.email,
  avatar: user.avatar,
  gender: user.gender,
  age: user.age,
  country: user.country,
  language: user.language,
  interests: user.interests,
  bio: user.bio,
  isVerified: user.isVerified,
});

// Helper: generate new session + refresh token + cookie + access token
export const createSessionAndTokens = async (user, req, res) => {
  const rawRefreshToken = crypto.randomBytes(32).toString("hex");
  const refreshTokenHash = crypto.createHash("sha256").update(rawRefreshToken).digest("hex");
  
  const refreshTtl = process.env.REFRESH_TOKEN_TTL || "30d";
  const refreshDurationMs = parseDurationToMs(refreshTtl);
  const expiresAt = new Date(Date.now() + refreshDurationMs);
  const family = crypto.randomUUID();

  const session = await Session.create({
    user: user._id,
    refreshTokenHash,
    family,
    device: {
      userAgent: req.headers["user-agent"] || "unknown",
      ip: req.ip || "unknown",
      label: getDeviceLabel(req.headers["user-agent"]),
    },
    expiresAt,
  });

  const accessTokenTtl = process.env.ACCESS_TOKEN_TTL || "15m";
  const accessToken = jwt.sign(
    { userId: user._id, role: user.role, sessionId: session._id },
    JWT_SECRET,
    { expiresIn: accessTokenTtl }
  );

  // Set Cookie scoped to refresh path
  const isProd = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", rawRefreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/api/auth/refresh",
    maxAge: refreshDurationMs,
  });

  return { accessToken, refreshToken: rawRefreshToken };
};

export const registerUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  logger.info(`📝 Registration attempt for: ${email}`);

  // Enforce the password policy before anything else touches it. The client
  // shows the same rules live, but that check is bypassable.
  const passwordIssue = firstPasswordIssue(password, { name, email });
  if (passwordIssue) {
    logger.warn(`❌ Registration failed - weak password: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_REGISTER_FAILURE,
      actor:      null,
      req,
      targetType: "User",
      targetId:   email,
      status:     "failure",
      metadata:   { email, reason: "weak_password" },
    });
    return next(new APIError(passwordIssue, 400));
  }

  // Reject passwords that appear in real-world breach dumps (HIBP range API,
  // SHA-1 prefix only — the password is never transmitted). Fails open on a
  // HIBP outage so signups don't break.
  const breached = await isPasswordBreached(password);
  if (breached) {
    logger.warn(`❌ Registration failed - breached password: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_REGISTER_FAILURE,
      actor:      null,
      req,
      targetType: "User",
      targetId:   email,
      status:     "failure",
      metadata:   { email, reason: "breached_password" },
    });
    return next(
      new APIError(
        "This password has appeared in a known data breach. Please choose a different one.",
        400
      )
    );
  }

  // Check if user already exists
  const existing = await User.findOne({ email });
  if (existing) {
    logger.warn(`❌ Registration failed - Email already exists: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_REGISTER_FAILURE,
      actor:      null,
      req,
      targetType: "User",
      targetId:   email,
      status:     "failure",
      metadata:   { email, reason: "email_already_exists" },
    });
    return next(new APIError("Email already exists", 400));
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Users can only self-register as student or mentor. Privileged roles
  // (admin) can never be self-assigned — they are granted only to accounts
  // whose email is on the ADMIN_EMAILS whitelist.
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const allowedSelfRegistrationRoles = ["student", "mentor"];
  let assignedRole = allowedSelfRegistrationRoles.includes(role) ? role : "student";

  if (ADMIN_EMAILS.includes(email.toLowerCase())) {
    assignedRole = "admin";
    logger.info(`👑 Whitelisted admin account registering: ${email}`);
  } else if (!allowedSelfRegistrationRoles.includes(role)) {
    logger.warn(
      `⛔ Blocked invalid role attempt: ${email} tried to register as "${role}"`
    );
    assignedRole = "student";
  }

  // Generate verification token
  const verificationToken = crypto.randomBytes(32).toString("hex");

  // Store pending user (auto-deletes after 24h via TTL index)
  const pendingUser = await PendingUser.findOneAndUpdate(
    { email },
    {
      name,
      email,
      password: hashedPassword,
      role: assignedRole,
      verificationToken,
    },
    { upsert: true, new: true },
  );

  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (err) {
    // Email delivery failed (e.g. provider outage / disconnected sender).
    // Roll back the pending record so the user can retry cleanly, and return a
    // clear 503 rather than a generic 500 "Programming Error".
    await PendingUser.deleteOne({ _id: pendingUser._id }).catch(() => {});
    logger.error(`Verification email delivery failed for ${email}: ${err.message}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_REGISTER_FAILURE,
      actor:      null,
      req,
      targetType: "User",
      targetId:   email,
      status:     "failure",
      metadata:   { email, reason: "verification_email_failed" },
    });
    return next(
      new APIError(
        "We couldn't send your verification email right now. Please try again in a few minutes.",
        503
      )
    );
  }

  recordAudit({
    action:     AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS,
    actor:      pendingUser._id,
    req,
    targetType: "User",
    targetId:   pendingUser._id.toString(),
    status:     "success",
    metadata:   { email, assignedRole, name },
  });

  res.status(201).json({
    success: true,
    message:
      "Please check your email to verify your account. The link expires in 24 hours.",
  });
});

export const verifyEmail = catchAsync(async (req, res, next) => {
  const { token } = req.params;

  if (!token) {
    return next(new APIError("Verification token is required", 400));
  }

  // Find the pending user by token
  const pending = await PendingUser.findOne({ verificationToken: token });

  if (!pending) {
    return next(new APIError("Invalid or expired verification token. Please register again.", 400));
  }

  // Check for duplicate (e.g., if another registration happened in the meantime)
  const existing = await User.findOne({ email: pending.email });
  if (existing) {
    await PendingUser.deleteOne({ _id: pending._id });
    return next(new APIError("This email is already registered. Please log in.", 400));
  }

  // Create the real user
  const user = await User.create({
    name: pending.name,
    email: pending.email,
    password: pending.password,
    role: pending.role,
    isVerified: true,
  });

  // Remove the pending record
  await PendingUser.deleteOne({ _id: pending._id });

  // Generate session and tokens so user is logged in immediately
  const { accessToken, refreshToken } = await createSessionAndTokens(user, req, res);

  logger.info(`✅ Email verified & user created: ${user.email} (ID: ${user._id})`);

  res.status(200).json({
    success: true,
    message: "Email verified successfully. Welcome to DeenBridge!",
    accessToken,
    refreshToken,
    token: accessToken,
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
      isVerified: true,
    },
  });
});

export const resendVerification = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  if (!email) {
    return next(new APIError("Email is required", 400));
  }

  const pending = await PendingUser.findOne({ email });

  if (!pending) {
    // Check if user is already fully registered
    const user = await User.findOne({ email });
    if (user) {
      return next(new APIError("This email is already verified. Please log in.", 400));
    }
    return next(new APIError("No pending registration found with this email. Please register first.", 404));
  }

  const verificationToken = crypto.randomBytes(32).toString("hex");
  pending.verificationToken = verificationToken;
  await pending.save();

  try {
    await sendVerificationEmail(email, verificationToken);
  } catch (err) {
    // Provider outage / disconnected sender — return a clear 503 so the client
    // can prompt a retry instead of surfacing a generic 500.
    logger.error(`Verification email resend failed for ${email}: ${err.message}`);
    return next(
      new APIError(
        "We couldn't resend your verification email right now. Please try again in a few minutes.",
        503
      )
    );
  }

  logger.info(`📧 Verification email resent to: ${email}`);

  res.status(200).json({
    success: true,
    message: "Verification email sent. Please check your inbox.",
  });
});

export const loginUser = catchAsync(async (req, res, next) => {
  const { email, password } = req.body;

  logger.info(`🔐 Login attempt for: ${email} from IP: ${req.ip}`);

  // Validate input
  if (!email || !password) {
    return next(new APIError("Please provide email and password", 400));
  }

  // Find user
  const user = await User.findOne({ email }).select("+password");
  if (!user) {
    logger.warn(`❌ Login failed - User not found: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
      actor:      null,
      req,
      targetType: "User",
      targetId:   email,
      status:     "failure",
      metadata:   { email, reason: "user_not_found" },
    });
    return next(new APIError("Invalid credentials", 401));
  }

  // Per-account lockout: reject BEFORE running bcrypt while the account is
  // locked, and do not leak whether the account exists beyond the generic
  // "too many attempts" response.
  const isLocked = user.lockUntil && new Date(user.lockUntil) > new Date();
  if (isLocked) {
    logger.warn(`🔒 Login blocked - account locked: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED,
      actor:      user._id,
      req,
      targetType: "User",
      targetId:   user._id.toString(),
      status:     "failure",
      metadata:   { email, reason: "account_locked" },
    });
    return next(
      new APIError("Too many failed login attempts. Please try again later.", 429)
    );
  }

  // Verify password
  const isPasswordCorrect = await bcrypt.compare(password, user.password);
  if (!isPasswordCorrect) {
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
    if (user.failedLoginAttempts >= LOGIN_MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(
        Date.now() + lockoutDurationMs(user.failedLoginAttempts)
      );
      logger.warn(
        `🔒 Account locked after ${user.failedLoginAttempts} failed attempts: ${email}`
      );
      recordAudit({
        action:     AUDIT_ACTIONS.AUTH_ACCOUNT_LOCKED,
        actor:      user._id,
        req,
        targetType: "User",
        targetId:   user._id.toString(),
        status:     "failure",
        metadata:   { email, reason: "account_locked" },
      });
    }
    await user.save({ validateBeforeSave: false });

    logger.warn(`❌ Login failed - Incorrect password: ${email}`);
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_LOGIN_FAILURE,
      actor:      user._id,
      req,
      targetType: "User",
      targetId:   user._id.toString(),
      status:     "failure",
      metadata:   { email, reason: "invalid_password" },
    });
    return next(new APIError("Invalid credentials", 401));
  }

  // Auto-promote whitelisted admin emails (self-healing for existing accounts)
  const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  if (ADMIN_EMAILS.includes(user.email.toLowerCase()) && user.role !== "admin") {
    user.role = "admin";
    await user.save({ validateBeforeSave: false });
    logger.info(`👑 Promoted ${user.email} to admin (whitelisted account)`);
  }

  // Update last login and clear any lockout state (success is the reset).
  user.lastLogin = new Date();
  if (user.failedLoginAttempts || user.lockUntil) {
    user.failedLoginAttempts = 0;
    user.lockUntil = null;
  }
  await user.save({ validateBeforeSave: false });

  // Generate session and tokens
  const { accessToken, refreshToken } = await createSessionAndTokens(user, req, res);

  logger.info(`✅ Login successful: ${email} (ID: ${user._id})`);

  recordAudit({
    action:     AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
    actor:      user._id,
    req,
    targetType: "User",
    targetId:   user._id.toString(),
    status:     "success",
    metadata:   { email, role: user.role },
  });

  res.status(200).json({
    success: true,
    message: "Login successful",
    accessToken,
    refreshToken,
    token: accessToken, // legacy token field
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
      avatar: user.avatar,
      gender: user.gender,
      age: user.age,
      country: user.country,
      language: user.language,
      interests: user.interests,
      bio: user.bio,
      isVerified: user.isVerified,
    },
  });
});

// Request password reset (sends OTP)
export const requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  try {
    logger.info("🔑 Password reset requested for:", email);

    if (!email || typeof email !== "string") {
      return res.status(400).json({ success: false, message: "Invalid email address" });
    }

    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({
        success: true,
        message:
          "If an account exists with this email, you will receive a password reset code.",
      });
    }

    // Generate a 6-digit OTP
    const otp = generateOtp();

    // Store OTP hash and expiry in database (15 minutes)
    const hashedOtp = await hashOtp(otp);
    user.resetTokenHash = hashedOtp;
    user.resetTokenExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await user.save();

    // Send OTP via email with error handling to preserve anti-enumeration and clear orphaned tokens
    try {
      await sendOtpEmail(otp, email);
    } catch (mailErr) {
      logger.error("❌ Password reset email delivery error:", mailErr.message);
      user.resetTokenHash = undefined;
      user.resetTokenExpiry = undefined;
      await user.save();
    }

    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_PASSWORD_RESET_REQUEST,
      actor:      user._id,
      req,
      targetType: "User",
      targetId:   user._id.toString(),
      status:     "success",
      metadata:   { email },
    });

    res.status(200).json({
      success: true,
      message:
        "If an account exists with this email, you will receive a password reset code.",
    });
  } catch (err) {
    logger.error("❌ Password reset request error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// Reset password with OTP
export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    logger.info("🔐 Password reset attempt for:", email);

    if (!email || !otp || !newPassword) {
      return res.status(400).json({ success: false, message: "Email, OTP, and new password are required" });
    }

    // Same policy as registration — a reset must not be a way around it.
    const newPasswordIssue = firstPasswordIssue(newPassword, { email });
    if (newPasswordIssue) {
      logger.warn(`❌ Password reset failed - weak password: ${email}`);
      return res.status(400).json({ success: false, message: newPasswordIssue });
    }

    // A reset must not be a way around a breached-password rejection either.
    const breached = await isPasswordBreached(newPassword);
    if (breached) {
      logger.warn(`❌ Password reset failed - breached password: ${email}`);
      return res.status(400).json({
        success: false,
        message:
          "This password has appeared in a known data breach. Please choose a different one.",
      });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    // Verify OTP presence and expiration
    if (
      !user.resetTokenHash ||
      !user.resetTokenExpiry ||
      new Date(user.resetTokenExpiry) < new Date()
    ) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    const isValidOtp = await verifyOtp(otp.toString(), user.resetTokenHash);
    if (!isValidOtp) {
      return res.status(400).json({ success: false, message: "Invalid or expired OTP" });
    }

    // Hash new password using cost factor 12 (aligned with registerUser)
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    user.password = hashedPassword;

    // Clear reset token fields (single use)
    user.resetTokenHash = undefined;
    user.resetTokenExpiry = undefined;
    await user.save();

    logger.info("✅ Password reset successful for:", email);

    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_PASSWORD_RESET_COMPLETE,
      actor:      user._id,
      req,
      targetType: "User",
      targetId:   user._id.toString(),
      status:     "success",
      metadata:   { email },
    });

    res.status(200).json({
      success: true,
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (err) {
    logger.error("❌ Password reset error:", err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

export const refreshSession = catchAsync(async (req, res, next) => {
  const rawToken = req.cookies.refreshToken || req.body.refreshToken;
  if (!rawToken) {
    return next(new APIError("No refresh token provided", 401));
  }

  const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const session = await Session.findOne({ refreshTokenHash: hash }).populate("user");

  if (!session) {
    return next(new APIError("Invalid refresh token", 401));
  }

  // Expired-but-honest check
  if (session.expiresAt < new Date()) {
    return next(new APIError("Refresh token expired", 401));
  }

  // Reuse detection
  if (session.revokedAt || session.replacedBy) {
    await Session.updateMany(
      { family: session.family },
      { $set: { revokedAt: new Date() } }
    );
    logger.warn(
      `🚨 Refresh token reuse detected! Revoked entire token family. Family: ${session.family}, IP: ${req.ip}, UA: ${req.headers["user-agent"]}`
    );
    return next(new APIError("Refresh token has been reused", 401));
  }

  // Perform rotation
  const newRawToken = crypto.randomBytes(32).toString("hex");
  const newHash = crypto.createHash("sha256").update(newRawToken).digest("hex");
  
  const refreshTtl = process.env.REFRESH_TOKEN_TTL || "30d";
  const refreshDurationMs = parseDurationToMs(refreshTtl);
  const newExpiresAt = new Date(Date.now() + refreshDurationMs);

  const newSession = await Session.create({
    user: session.user._id,
    refreshTokenHash: newHash,
    family: session.family,
    device: {
      userAgent: req.headers["user-agent"] || "unknown",
      ip: req.ip || "unknown",
      label: getDeviceLabel(req.headers["user-agent"]),
    },
    expiresAt: newExpiresAt,
  });

  session.revokedAt = new Date();
  session.replacedBy = newSession._id;
  session.lastUsedAt = new Date();
  await session.save();

  const accessTokenTtl = process.env.ACCESS_TOKEN_TTL || "15m";
  const accessToken = jwt.sign(
    { userId: session.user._id, role: session.user.role, sessionId: newSession._id },
    JWT_SECRET,
    { expiresIn: accessTokenTtl }
  );

  const isProd = process.env.NODE_ENV === "production";
  res.cookie("refreshToken", newRawToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/api/auth/refresh",
    maxAge: refreshDurationMs,
  });

  res.status(200).json({
    success: true,
    accessToken,
    refreshToken: newRawToken,
    token: accessToken, // legacy token field
    user: {
      id: session.user._id,
      name: session.user.name,
      role: session.user.role,
      email: session.user.email,
      avatar: session.user.avatar,
      gender: session.user.gender,
      age: session.user.age,
      country: session.user.country,
      language: session.user.language,
      interests: session.user.interests,
      bio: session.user.bio,
      isVerified: session.user.isVerified,
    },
  });
});

export const getSessions = catchAsync(async (req, res, next) => {
  const activeSessions = await Session.find({
    user: req.user._id,
    revokedAt: null,
    expiresAt: { $gt: new Date() },
  });

  const formattedSessions = activeSessions.map((session) => ({
    id: session._id,
    device: session.device,
    lastUsedAt: session.lastUsedAt,
    isCurrent: req.sessionId ? session._id.toString() === req.sessionId.toString() : false,
  }));

  res.status(200).json({
    success: true,
    sessions: formattedSessions,
  });
});

export const revokeSession = catchAsync(async (req, res, next) => {
  const session = await Session.findOne({
    _id: req.params.sessionId,
    user: req.user._id,
  });

  if (!session) {
    return next(new APIError("Session not found", 404));
  }

  session.revokedAt = new Date();
  await session.save();

  res.status(200).json({
    success: true,
    message: "Session revoked successfully",
  });
});

export const revokeAllOtherSessions = catchAsync(async (req, res, next) => {
  if (!req.sessionId) {
    return next(new APIError("Cannot revoke other sessions from a legacy session. Please re-login.", 400));
  }

  await Session.updateMany(
    {
      user: req.user._id,
      _id: { $ne: req.sessionId },
      revokedAt: null,
    },
    {
      $set: { revokedAt: new Date() }
    }
  );

  res.status(200).json({
    success: true,
    message: "All other sessions revoked successfully",
  });
});

export const logoutUser = catchAsync(async (req, res, next) => {
  if (req.sessionId) {
    await Session.updateOne(
      { _id: req.sessionId },
      { $set: { revokedAt: new Date() } }
    );
  }

  const rawToken = req.cookies.refreshToken || req.body.refreshToken;
  if (rawToken) {
    const hash = crypto.createHash("sha256").update(rawToken).digest("hex");
    await Session.updateOne(
      { refreshTokenHash: hash },
      { $set: { revokedAt: new Date() } }
    );
  }

  recordAudit({
    action:     AUDIT_ACTIONS.AUTH_LOGOUT,
    actor:      req.user?._id ?? null,
    req,
    targetType: "User",
    targetId:   req.user?._id?.toString() ?? null,
    status:     "success",
    metadata:   null,
  });

  const isProd = process.env.NODE_ENV === "production";
  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: isProd,
    sameSite: isProd ? "None" : "Lax",
    path: "/api/auth/refresh",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});

// Change password for an authenticated user. Verifies the current password,
// enforces the password policy on the new one, and signs out all OTHER sessions.
export const changePassword = catchAsync(async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return next(new APIError("Current and new password are required", 400));
  }

  const passwordIssue = firstPasswordIssue(newPassword, {
    name: req.user?.name,
    email: req.user?.email,
  });
  if (passwordIssue) {
    return next(new APIError(passwordIssue, 400));
  }

  const user = await User.findById(req.user._id).select("+password");
  if (!user || !user.password) {
    return next(new APIError("User not found", 404));
  }

  const isCurrentCorrect = await bcrypt.compare(currentPassword, user.password);
  if (!isCurrentCorrect) {
    recordAudit({
      action:     AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
      actor:      user._id,
      req,
      targetType: "User",
      targetId:   user._id.toString(),
      status:     "failure",
      metadata:   { reason: "invalid_current_password" },
    });
    return next(new APIError("Current password is incorrect", 401));
  }

  const isSameAsOld = await bcrypt.compare(newPassword, user.password);
  if (isSameAsOld) {
    return next(
      new APIError("New password must be different from the current one", 400)
    );
  }

  user.password = await bcrypt.hash(newPassword, 12);
  await user.save();

  // Sign out every OTHER session so a password change kicks other devices.
  await Session.deleteMany({ user: user._id, _id: { $ne: req.sessionId } });

  recordAudit({
    action:     AUDIT_ACTIONS.AUTH_PASSWORD_CHANGE,
    actor:      user._id,
    req,
    targetType: "User",
    targetId:   user._id.toString(),
    status:     "success",
    metadata:   {},
  });

  res.status(200).json({
    success: true,
    message:
      "Password changed successfully. Other devices have been signed out.",
  });
});
