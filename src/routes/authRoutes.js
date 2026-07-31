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

// Stellar SEP-10 auth — not yet implemented
router.get("/stellar/challenge", (req, res) => {
  res.status(503).json({
    success: false,
    message:
      "Sign in with Stellar is not available yet. Please use email login.",
  });
});
router.post("/stellar/verify", (req, res) => {
  res.status(503).json({
    success: false,
    message:
      "Sign in with Stellar is not available yet. Please use email login.",
  });
});

// Token refresh route with dedicated refresh rate limit
router.post("/refresh", refreshLimiter, refreshSession);

// Protected session management routes
router.post("/logout", protect, logoutUser);
router.get("/sessions", protect, getSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);
router.delete("/sessions", protect, revokeAllOtherSessions);

export default router;
