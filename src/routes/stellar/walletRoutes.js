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

const router = express.Router();

// Protected routes (require authentication)
router.post("/connect", protect, connectWallet);
router.delete("/disconnect", protect, disconnectWallet);
router.get("/me", protect, getMyWallet);

// Lookup routes require authentication to avoid wallet/user enumeration.
router.get("/balance/:publicKey", protect, getWalletBalance);
router.get("/check/:userId", protect, checkUserWallet);

export default router;
