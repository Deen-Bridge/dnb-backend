const express = require("express");
const router = express.Router();

const {
  getWalletBalance,
  checkUserWallet,
  connectWallet,
  disconnectWallet,
  getMyWallet,
} = require("../../controllers/stellar/walletController");

// auth middleware
const { protect } = require("../../middlewares/authMiddleware");

// -------------------------------------------------------------------
// Public routes that need protection (added `protect`)
// -------------------------------------------------------------------

// Require authentication for balance lookup – prevents open proxy abuse
router.get("/balance/:publicKey", protect, getWalletBalance);

// Require authentication for user‑wallet checks – prevents enumeration
router.get("/check/:userId", protect, checkUserWallet);

// -------------------------------------------------------------------
// Authenticated routes (already protected)
// -------------------------------------------------------------------
router.post("/connect", protect, connectWallet);
router.post("/disconnect", protect, disconnectWallet);
router.get("/me", protect, getMyWallet);

module.exports = router;
