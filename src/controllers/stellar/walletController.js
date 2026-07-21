// controllers/stellar/walletController.js
import mongoose from "mongoose";
import User from "../../models/User.js";
import {
  isValidPublicKey,
  getAccountBalance,
  NETWORK,
} from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";

/**
 * Connect Stellar wallet to user profile
 * POST /api/stellar/wallet/connect
 */
export const connectWallet = async (req, res) => {
  try {
    const userId = req.user._id;
    const { publicKey } = req.body;

    // Validate public key format
    if (!publicKey || !isValidPublicKey(publicKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Stellar public key",
      });
    }

    // Check if wallet is already connected to another user
    const existingUser = await User.findOne({
      "stellarWallet.publicKey": publicKey,
      _id: { $ne: userId },
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "This wallet is already connected to another account",
      });
    }

    // Verify account exists on Stellar network and get balance info
    const accountInfo = await getAccountBalance(publicKey);

    // Update user with wallet info
    const user = await User.findByIdAndUpdate(
      userId,
      {
        stellarWallet: {
          publicKey,
          connectedAt: new Date(),
          network: NETWORK,
        },
      },
      { new: true }
    ).select("-password");

    logger.info(`Wallet connected for user ${userId}: ${publicKey}`);

    res.status(200).json({
      success: true,
      message: "Wallet connected successfully",
      wallet: {
        publicKey,
        network: NETWORK,
        ...accountInfo,
      },
    });
  } catch (error) {
    logger.error("Connect wallet error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to connect wallet",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Disconnect wallet from user profile
 * DELETE /api/stellar/wallet/disconnect
 */
export const disconnectWallet = async (req, res) => {
  try {
    const userId = req.user._id;

    await User.findByIdAndUpdate(userId, {
      $unset: { stellarWallet: 1 },
    });

    logger.info(`Wallet disconnected for user ${userId}`);

    res.status(200).json({
      success: true,
      message: "Wallet disconnected successfully",
    });
  } catch (error) {
    logger.error("Disconnect wallet error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to disconnect wallet",
    });
  }
};

/**
 * Get wallet balance for any public key
 * GET /api/stellar/wallet/balance/:publicKey
 */
export const getWalletBalance = async (req, res) => {
  try {
    const { publicKey } = req.params;

    if (!isValidPublicKey(publicKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid public key",
      });
    }

    const balance = await getAccountBalance(publicKey);

    res.status(200).json({
      success: true,
      publicKey,
      ...balance,
    });
  } catch (error) {
    logger.error("Get wallet balance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch balance",
    });
  }
};

/**
 * Get current user's wallet info
 * GET /api/stellar/wallet/me
 */
export const getMyWallet = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("stellarWallet");

    if (!user?.stellarWallet?.publicKey) {
      return res.status(200).json({
        success: true,
        connected: false,
      });
    }

    // Get live balance from Stellar network
    const balance = await getAccountBalance(user.stellarWallet.publicKey);

    res.status(200).json({
      success: true,
      connected: true,
      wallet: {
        ...user.stellarWallet.toObject(),
        ...balance,
      },
    });
  } catch (error) {
    logger.error("Get my wallet error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch wallet info",
    });
  }
};

/**
 * Check if a user has a connected wallet
 * GET /api/stellar/wallet/check/:userId
 */
export const checkUserWallet = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID",
      });
    }

    const user = await User.findById(userId).select(
      "stellarWallet.publicKey"
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      hasWallet: !!user.stellarWallet?.publicKey,
    });
  } catch (error) {
    logger.error("Check user wallet error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check wallet status",
    });
  }
};
