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

// Public routes
router.get("/balance/:publicKey", getWalletBalance);
router.get("/check/:userId", checkUserWallet);

export default router;
