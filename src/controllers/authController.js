// controllers/authController.js
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import User from "../models/User.js";
import Session from "../models/Session.js";
import sendMail from "../../services/emails/sendMail.js";
import { generatedOtp } from "../routes/emailRoutes.js";
import logger from "../config/logger.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

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

// Helper: generate new session + refresh token + cookie + access token
const createSessionAndTokens = async (user, req, res) => {
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
  res.cookie("refreshToken", rawRefreshToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/api/auth/refresh",
    maxAge: refreshDurationMs,
  });

  return { accessToken, refreshToken: rawRefreshToken };
};

export const registerUser = catchAsync(async (req, res, next) => {
  const { name, email, password, role } = req.body;

  logger.info(`📝 Registration attempt for: ${email}`);

  // Check if user already exists
  const existing = await User.findOne({ email });
  if (existing) {
    logger.warn(`❌ Registration failed - Email already exists: ${email}`);
    return next(new APIError("Email already exists", 400));
  }

  // Send OTP email
  try {
    await sendMail(generatedOtp, email);
    logger.info(`📧 OTP sent to: ${email}`);
  } catch (error) {
    logger.error(`Email sending failed for: ${email}`, error);
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 12);

  // Create user
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: role || "student",
  });

  logger.info(`✅ User registered successfully: ${email} (ID: ${user._id})`);

  // Generate session and tokens
  const { accessToken, refreshToken } = await createSessionAndTokens(user, req, res);

  res.status(201).json({
    success: true,
    message: "User created successfully",
    accessToken,
    refreshToken,
    token: accessToken, // legacy token field
    user: {
      id: user._id,
      name: user.name,
      role: user.role,
      email: user.email,
    },
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
    return next(new APIError("Invalid credentials", 401));
  }

  // Verify password
  const isPasswordCorrect = await bcrypt.compare(password, user.password);
  if (!isPasswordCorrect) {
    logger.warn(`❌ Login failed - Incorrect password: ${email}`);
    return next(new APIError("Invalid credentials", 401));
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save({ validateBeforeSave: false });

  // Generate session and tokens
  const { accessToken, refreshToken } = await createSessionAndTokens(user, req, res);

  logger.info(`✅ Login successful: ${email} (ID: ${user._id})`);

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
    },
  });
});

// Request password reset (sends OTP)
export const requestPasswordReset = async (req, res) => {
  const { email } = req.body;

  try {
    console.log("🔑 Password reset requested for:", email);
    const user = await User.findOne({ email });

    if (!user) {
      // Don't reveal if user exists or not for security
      return res.status(200).json({
        message:
          "If an account exists with this email, you will receive a password reset code.",
      });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // In production, you should:
    // 1. Store the OTP in database with expiration time
    // 2. Send email with OTP using your email service
    // For now, we'll use the existing sendMail function

    // Store OTP temporarily (you should add resetToken and resetTokenExpiry to User model)
    // user.resetToken = await bcrypt.hash(otp, 10);
    // user.resetTokenExpiry = Date.now() + 3600000; // 1 hour
    // await user.save();

    // Send OTP via email
    sendMail(otp, email);

    res.status(200).json({
      message: "Password reset code sent to your email",
      otp: otp, // Remove this in production! Only for development
    });
  } catch (err) {
    console.error("❌ Password reset request error:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// Reset password with OTP
export const resetPassword = async (req, res) => {
  const { email, otp, newPassword } = req.body;

  try {
    console.log("🔐 Password reset attempt for:", email);
    const user = await User.findOne({ email });

    if (!user) {
      return res.status(400).json({ message: "Invalid request" })
    }

    // In production, verify OTP from database
    // const isValidOtp = await bcrypt.compare(otp, user.resetToken);
    // if (!isValidOtp || user.resetTokenExpiry < Date.now()) {
    //   return res.status(400).json({ message: "Invalid or expired OTP" });
    // }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;

    // Clear reset token fields
    // user.resetToken = undefined;
    // user.resetTokenExpiry = undefined;
    await user.save();

    console.log("✅ Password reset successful for:", email);
    res.status(200).json({
      message:
        "Password reset successful. You can now login with your new password.",
    });
  } catch (err) {
    console.error("❌ Password reset error:", err.message);
    res.status(500).json({ error: err.message });
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

  res.cookie("refreshToken", newRawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "None",
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

  res.clearCookie("refreshToken", {
    httpOnly: true,
    secure: true,
    sameSite: "None",
    path: "/api/auth/refresh",
  });

  res.status(200).json({
    success: true,
    message: "Logged out successfully",
  });
});
