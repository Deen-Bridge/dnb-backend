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
} from "../controllers/authController.js";
import { protect } from "../middlewares/authMiddleware.js";
import { authLimiter, refreshLimiter } from "../middlewares/security.js";

const router = express.Router();

// Public routes with auth rate limit
router.post("/register", authLimiter, registerUser);
router.post("/login", authLimiter, loginUser);
router.post("/request-password-reset", authLimiter, requestPasswordReset);
router.post("/reset-password", authLimiter, resetPassword);

// Token refresh route with dedicated refresh rate limit
router.post("/refresh", refreshLimiter, refreshSession);

// Protected session management routes
router.post("/logout", protect, logoutUser);
router.get("/sessions", protect, getSessions);
router.delete("/sessions/:sessionId", protect, revokeSession);
router.delete("/sessions", protect, revokeAllOtherSessions);

export default router;
