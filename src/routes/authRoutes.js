// routes/authRoutes.js
import express from "express";
import {
  registerUser,
  loginUser,
  refreshSession,
  getSessions,
  revokeSession,
  revokeAllOtherSessions,
  logoutUser,
  requestPasswordReset,
  resetPassword,
  changePassword,
  verifyEmail,
  resendVerification,
  setup2FA,
  verify2FA,
  disable2FA,
} from "../controllers/authController.js";
import {
  getStellarChallenge,
  verifyStellarChallenge,
} from "../controllers/stellar/sep10Controller.js";
import { googleSignIn } from "../controllers/googleAuthController.js";
import { protect } from "../middlewares/authMiddleware.js";
import {
  refreshLimiter,
  twoFactorLimiter,
  emailAuthLimiter,
  captchaGate,
} from "../middlewares/security.js";
import { validate } from "../middlewares/validate.js";
import {
  registerValidation,
  loginValidation,
} from "../validators/requestValidators.js";
import {
  requestPasswordResetValidation,
  resendVerificationValidation,
  resetPasswordValidation,
  refreshValidation,
  changePasswordValidation,
  verify2FAValidation,
  disable2FAValidation,
  stellarVerifyValidation,
  googleAuthValidation,
} from "../validators/authValidators.js";

const router = express.Router();

// Public routes with auth rate limit.
// /register and /resend-verification also carry a per-EMAIL limiter (survives
// IP rotation) plus a pluggable captcha gate (no-op when unconfigured) —
// see issue #89.
router.post(
  "/register",
  emailAuthLimiter,
  captchaGate(),
  registerValidation,
  validate,
  registerUser
);
router.post("/login", loginValidation, validate, loginUser);
router.post(
  "/request-password-reset",
  requestPasswordResetValidation,
  validate,
  requestPasswordReset
);
router.post("/reset-password", resetPasswordValidation, validate, resetPassword);
router.get("/verify-email/:token", verifyEmail);
router.post(
  "/resend-verification",
  emailAuthLimiter,
  captchaGate(),
  resendVerificationValidation,
  validate,
  resendVerification
);

// 2FA Routes
router.post("/2fa/setup", protect, twoFactorLimiter, setup2FA);
router.post("/2fa/verify", twoFactorLimiter, (req, res, next) => {
  // If authorization header is provided and no mfaToken, pass through protect middleware first
  if (req.headers.authorization && !req.body.mfaToken) {
    return protect(req, res, next);
  }
  next();
}, verify2FAValidation, validate, verify2FA);
router.post(
  "/2fa/login",
  twoFactorLimiter,
  verify2FAValidation,
  validate,
  verify2FA
);
router.post(
  "/2fa/disable",
  protect,
  twoFactorLimiter,
  disable2FAValidation,
  validate,
  disable2FA
);

// Stellar SEP-10 Web Authentication ("Sign in with Stellar"). Returns 503 when
// the feature is unconfigured (SEP10_SIGNING_SECRET/domains unset). See #25.
router.get("/stellar/challenge", getStellarChallenge);
router.post(
  "/stellar/verify",
  stellarVerifyValidation,
  validate,
  verifyStellarChallenge
);

// "Continue with Google" — signs up or logs in in one step. Returns 503 when
// GOOGLE_CLIENT_ID is unset, same graceful-degrade pattern as Stellar above.
router.post("/google", googleAuthValidation, validate, googleSignIn);

// Token refresh route with dedicated refresh rate limit
router.post(
  "/refresh",
  refreshLimiter,
  refreshValidation,
  validate,
  refreshSession
);

// Protected session management routes
router.post("/logout", protect, logoutUser);
router.get("/sessions", protect, getSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);
router.delete("/sessions", protect, revokeAllOtherSessions);
router.put(
  "/change-password",
  protect,
  changePasswordValidation,
  validate,
  changePassword
);

export default router;
