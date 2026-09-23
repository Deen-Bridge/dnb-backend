const mongoose = require("mongoose");
const axios = require("axios");
const UserRepository = require("../../../mongo/repositories/UserRepository");

// Horizon base URL – keep existing env variable or default
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon.stellar.org";

/**
 * Validate a Stellar public key.
 * Stellar public keys are 56‑character base32 strings starting with 'G'.
 */
const isValidStellarPublicKey = (key) => {
  const regex = /^G[A-Z2-7]{55}$/;
  return regex.test(key);
};

/**
 * GET /api/stellar/wallet/balance/:publicKey
 * Returns the balance information for a given Stellar public key.
 * Protected – only authenticated users may call this endpoint.
 */
exports.getWalletBalance = async (req, res, next) => {
  try {
    const { publicKey } = req.params;

    // -----------------------------------------------------------------
    // Input validation
    // -----------------------------------------------------------------
    if (!publicKey || !isValidStellarPublicKey(publicKey)) {
      return res.status(400).json({
        success: false,
        message: "Invalid Stellar public key format.",
      });
    }

    // Proxy the request to Horizon (read‑only, no secret data)
    const horizonResponse = await axios.get(
      `${HORIZON_URL}/accounts/${publicKey}`
    );

    return res.status(200).json({
      success: true,
      data: horizonResponse.data,
    });
  } catch (err) {
    // Horizon returns 404 for unknown accounts – forward as not‑found
    if (err.response && err.response.status === 404) {
      return res.status(404).json({
        success: false,
        message: "Stellar account not found.",
      });
    }
    next(err);
  }
};

/**
 * GET /api/stellar/wallet/check/:userId
 * Returns whether the user has a connected Stellar wallet.
 * Protected – only authenticated users may query this.
 */
exports.checkUserWallet = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // -----------------------------------------------------------------
    // Validate MongoDB ObjectId format
    // -----------------------------------------------------------------
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Invalid user ID format.",
      });
    }

    // Fetch the user (only the fields we need)
    const user = await UserRepository.findById(userId, {
      select: "stellarPublicKey name",
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found.",
      });
    }

    // Return boolean + optional name (kept for backward compatibility)
    return res.status(200).json({
      success: true,
      data: {
        hasWallet: !!user.stellarPublicKey,
        // NOTE: name is retained for existing front‑end expectations;
        // if future privacy concerns arise, simply remove this field.
        name: user.name,
      },
    });
  } catch (err) {
    next(err);
  }
};
