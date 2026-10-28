// controllers/googleAuthController.js
//
// "Continue with Google" — verifies a Google Identity Services ID token and
// either logs the user in (existing googleId), links the Google identity to
// an existing email/password account (matching email, no googleId yet), or
// creates a brand-new account (first time we've seen this email at all).
// Unlike Stellar's SEP-10 flow this doubles as signup: Google has already
// verified the email, so there's no separate "prove, then link" step.
//
// When GOOGLE_CLIENT_ID is unconfigured, returns 503 so the frontend can
// disable/hide the button gracefully, same as the Stellar SEP-10 routes.
import { OAuth2Client } from "google-auth-library";
import User from "../models/User.js";
import { createSessionAndTokens, shapeAuthUser } from "./authController.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";
import { recordAudit } from "../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";
import logger from "../config/logger.js";

const isGoogleAuthConfigured = () => Boolean(process.env.GOOGLE_CLIENT_ID);

// Lazily constructed so importing this module never fails when the feature
// is unconfigured (mirrors isSep10Configured()'s style in sep10Service.js).
const getClient = () => new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

/**
 * POST /api/auth/google  { idToken }
 * Verifies the Google ID token and issues the exact same session/JWT as
 * email login or Stellar login.
 */
export const googleSignIn = catchAsync(async (req, res, next) => {
  if (!isGoogleAuthConfigured()) {
    return res.status(503).json({
      success: false,
      message: "Continue with Google is not available yet. Please use email login.",
    });
  }

  const { idToken } = req.body;

  let payload;
  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    payload = ticket.getPayload();
  } catch (err) {
    logger.warn(`❌ Google sign-in failed - invalid ID token: ${err.message}`);
    return next(new APIError("Invalid Google credential.", 401));
  }

  if (!payload?.email_verified) {
    return next(
      new APIError("Your Google email address is not verified.", 401)
    );
  }

  const { sub: googleId, email, name, picture } = payload;

  let user = await User.findOne({ $or: [{ googleId }, { email }] });
  let isNewUser = false;

  if (user && !user.googleId) {
    // Existing email/password account signing in with Google for the first
    // time — link the identities instead of creating a duplicate account.
    user.googleId = googleId;
    if (!user.avatar && picture) user.avatar = picture;
    await user.save();
    logger.info(`🔗 Linked Google account to existing user: ${email}`);
  } else if (!user) {
    const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const role = ADMIN_EMAILS.includes(email.toLowerCase()) ? "admin" : "student";

    user = await User.create({
      name: name || email.split("@")[0],
      email,
      googleId,
      avatar: picture,
      role,
      isVerified: true,
    });
    isNewUser = true;
    logger.info(`📝 New user via Google sign-in: ${email}`);
  }

  const { accessToken, refreshToken } = await createSessionAndTokens(user, req, res);

  recordAudit({
    action: isNewUser
      ? AUDIT_ACTIONS.AUTH_REGISTER_SUCCESS
      : AUDIT_ACTIONS.AUTH_LOGIN_SUCCESS,
    actor: user._id,
    req,
    targetType: "User",
    targetId: user._id.toString(),
    status: "success",
    metadata: { email, via: "google" },
  });

  logger.info(`✅ Google sign-in: ${email} (ID: ${user._id})`);

  return res.status(200).json({
    success: true,
    accessToken,
    refreshToken,
    token: accessToken,
    user: shapeAuthUser(user),
  });
});
