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
  verifyEmail,
  resendVerification,
} from "../controllers/authController.js";
import {
  getStellarChallenge,
  verifyStellarChallenge,
} from "../controllers/stellar/sep10Controller.js";
import { protect } from "../middlewares/authMiddleware.js";
import { refreshLimiter } from "../middlewares/security.js";

const router = express.Router();

// Public routes with auth rate limit
router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/request-password-reset", requestPasswordReset);
router.post("/reset-password", resetPassword);
router.get("/verify-email/:token", verifyEmail);
router.post("/resend-verification", resendVerification);

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

export default router;
