// routes/stellar/walletRoutes.js
import express from "express";
import { protect } from "../../middlewares/authMiddleware.js";
import {
  connectWallet,
  disconnectWallet,
  getWalletBalance,
  getMyWallet,
  checkUserWallet,
} from "../../controllers/stellar/walletController.js";
import { standardLimiter } from "../../middlewares/security.js";
import { validate } from "../../middlewares/validate.js";
import { connectWalletValidation } from "../../validators/requestValidators.js";

const router = express.Router();

// Protected routes (require authentication)
router.post(
  "/connect",
  protect,
  connectWalletValidation,
  validate,
  connectWallet
);
router.delete("/disconnect", protect, disconnectWallet);
router.get("/me", protect, getMyWallet);

// Lookup routes: previously public (enumeration / Horizon-proxy risk, #426).
// Now require auth plus a tighter per-IP limit on top of the mount limiter.
router.get("/balance/:publicKey", protect, standardLimiter, getWalletBalance);
// Owner-or-admin only; non-owners get a uniform 403 before any DB lookup.
router.get("/check/:userId", protect, standardLimiter, checkUserWallet);

export default router;
