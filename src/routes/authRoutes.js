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
import { protect } from "../middlewares/authMiddleware.js";
import {
  refreshLimiter,
  twoFactorLimiter,
  emailAuthLimiter,
  captchaGate,
} from "../middlewares/security.js";

const router = express.Router();

// Public routes with auth rate limit.
// /register and /resend-verification also carry a per-EMAIL limiter (survives
// IP rotation) plus a pluggable captcha gate (no-op when unconfigured) —
// see issue #89.
router.post("/register", emailAuthLimiter, captchaGate(), registerUser);
router.post("/login", loginUser);
router.post("/request-password-reset", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.get("/verify-email/:token", verifyEmail);
router.post(
  "/resend-verification",
  emailAuthLimiter,
  captchaGate(),
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
}, verify2FA);
router.post("/2fa/login", twoFactorLimiter, verify2FA);
router.post("/2fa/disable", protect, twoFactorLimiter, disable2FA);

// Stellar SEP-10 Web Authentication ("Sign in with Stellar"). Returns 503 when
// the feature is unconfigured (SEP10_SIGNING_SECRET/domains unset). See #25.
router.get("/stellar/challenge", getStellarChallenge);
router.post("/stellar/verify", verifyStellarChallenge);

// Token refresh route with dedicated refresh rate limit
router.post("/refresh", refreshLimiter, refreshSession);

// Protected session management routes
router.post("/logout", protect, logoutUser);
router.get("/sessions", protect, getSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);
router.delete("/sessions", protect, revokeAllOtherSessions);
router.put("/change-password", protect, changePassword);

export default router;
