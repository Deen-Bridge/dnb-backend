// controllers/stellar/walletController.js
import User from "../../models/User.js";
import {
  isValidPublicKey,
  getAccountBalance,
  NETWORK,
} from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";
import { recordAudit } from "../../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../../models/AuditLog.js";

/**
 * Connect Stellar wallet to user profile
 * POST /api/stellar/wallet/connect
 */
export const connectWallet = async (req, res) => {
  try {
    const userId = req.user._id;
    const { publicKey } = req.body;

    if (!publicKey || !isValidPublicKey(publicKey)) {
      recordAudit({
        action:     AUDIT_ACTIONS.WALLET_CONNECT_FAILURE,
        actor:      userId,
        req,
        targetType: "Wallet",
        targetId:   publicKey ?? null,
        status:     "failure",
        metadata:   { reason: "invalid_public_key" },
      });
      return res.status(400).json({
        success: false,
        message: "Invalid Stellar public key",
      });
    }

    const existingUser = await User.findOne({
      "stellarWallet.publicKey": publicKey,
      _id: { $ne: userId },
    });

    if (existingUser) {
      recordAudit({
        action:     AUDIT_ACTIONS.WALLET_REASSIGN_ATTEMPT,
        actor:      userId,
        req,
        targetType: "Wallet",
        targetId:   publicKey,
        status:     "failure",
        metadata:   { publicKey, reason: "wallet_already_claimed", conflictUserId: existingUser._id.toString() },
      });
      return res.status(400).json({
        success: false,
        message: "This wallet is already connected to another account",
      });
    }

    // Verify account exists on Stellar network and get balance/trustline info
    // (accountInfo now includes per-asset balances/trustlines from the
    // registry, e.g. { balances: { USDC, EURC }, trustlines: { USDC, EURC } })
    const accountInfo = await getAccountBalance(publicKey);

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

    recordAudit({
      action:     AUDIT_ACTIONS.WALLET_CONNECT_SUCCESS,
      actor:      userId,
      req,
      targetType: "Wallet",
      targetId:   publicKey,
      status:     "success",
      metadata:   { publicKey, network: NETWORK },
    });

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

    // Capture the wallet key before unsetting it (for the audit row)
    const currentUser = await User.findById(userId).select("stellarWallet");
    const previousPublicKey = currentUser?.stellarWallet?.publicKey ?? null;

    await User.findByIdAndUpdate(userId, {
      $unset: { stellarWallet: 1 },
    });

    logger.info(`Wallet disconnected for user ${userId}`);

    recordAudit({
      action:     AUDIT_ACTIONS.WALLET_DISCONNECT,
      actor:      userId,
      req,
      targetType: "Wallet",
      targetId:   previousPublicKey,
      status:     "success",
      metadata:   { previousPublicKey },
    });

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
 * Response now includes balances/trustlines per registry asset (USDC,
 * EURC, XLM, ...) alongside the back-compat usdcBalance/hasTrustline
 * fields, so the UI can prompt e.g. "add a EURC trustline" when needed.
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

    // Get live balance/trustlines from Stellar network (per-asset)
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

    const user = await User.findById(userId).select(
      "stellarWallet.publicKey name"
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
      userName: user.name,
    });
  } catch (error) {
    logger.error("Check user wallet error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check wallet status",
    });
  }
};