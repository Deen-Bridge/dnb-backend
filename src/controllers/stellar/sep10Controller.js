// controllers/stellar/sep10Controller.js
//
// "Sign in with Stellar" (SEP-10). Wire format matches the merged frontend
// (dnb-frontend #164 / hooks/useStellarAuth.js):
//   GET  /api/auth/stellar/challenge?account=G… → { transaction, networkPassphrase }
//   POST /api/auth/stellar/verify   { transaction } → { token, user }  (linked wallet)
//                                                    → 200 { registered:false, accountProven } (unlinked)
// When the feature is unconfigured, both return 503 so the frontend disables the
// button gracefully instead of erroring.
import User from "../../models/User.js";
import {
  buildChallenge,
  verifyChallenge,
  isSep10Configured,
} from "../../services/stellar/sep10Service.js";
import {
  createSessionAndTokens,
  shapeAuthUser,
} from "../authController.js";
import { catchAsync } from "../../middlewares/errorHandler.js";
import logger from "../../config/logger.js";

/**
 * GET /api/auth/stellar/challenge?account=G…
 * Returns a server-signed SEP-10 challenge for the wallet to sign.
 */
export const getStellarChallenge = catchAsync(async (req, res) => {
  if (!isSep10Configured()) {
    return res.status(503).json({
      success: false,
      message:
        "Sign in with Stellar is not available yet. Please use email login.",
    });
  }

  const account = req.query.account;
  try {
    const { transaction, network_passphrase } = buildChallenge(account);
    return res.status(200).json({
      success: true,
      transaction,
      // camelCase for the frontend; snake_case for SEP-10-conformant wallets.
      networkPassphrase: network_passphrase,
      network_passphrase,
    });
  } catch (err) {
    if (err.code === "INVALID_ACCOUNT") {
      return res.status(400).json({ success: false, message: err.message });
    }
    throw err;
  }
});

/**
 * POST /api/auth/stellar/verify  { transaction: <signed XDR> }
 * Verifies the signed challenge; issues a platform JWT for a linked wallet or
 * reports the proven-but-unregistered account without creating a user.
 */
export const verifyStellarChallenge = catchAsync(async (req, res) => {
  if (!isSep10Configured()) {
    return res.status(503).json({
      success: false,
      message:
        "Sign in with Stellar is not available yet. Please use email login.",
    });
  }

  const signedXdr = req.body?.transaction;

  let provenAccount;
  try {
    provenAccount = await verifyChallenge(signedXdr);
  } catch (err) {
    if (err.code === "CHALLENGE_REPLAYED") {
      return res.status(401).json({ success: false, message: err.message });
    }
    // INVALID_CHALLENGE covers wrong sig, expired time bounds, tampered domain.
    // 401 + the SDK message lets the frontend detect expiry and retry once.
    return res.status(401).json({
      success: false,
      message: err.message || "Challenge verification failed.",
    });
  }

  const user = await User.findOne({
    "stellarWallet.publicKey": provenAccount,
  }).select("-password");

  // Ownership is cryptographically proven but no account is linked to it yet.
  // Do NOT create a user here — let the frontend route to signup/link.
  if (!user) {
    logger.info(
      `SEP-10: proven unregistered wallet ${provenAccount.slice(0, 6)}…`
    );
    return res.status(200).json({
      success: true,
      registered: false,
      accountProven: provenAccount,
    });
  }

  // Linked wallet → issue the exact same session/JWT as email login.
  const { accessToken, refreshToken } = await createSessionAndTokens(
    user,
    req,
    res
  );

  logger.info(
    `✅ SEP-10 login: ${user.email} via wallet ${provenAccount.slice(0, 6)}…`
  );

  return res.status(200).json({
    success: true,
    accessToken,
    refreshToken,
    token: accessToken, // legacy field the frontend reads as `token`
    user: shapeAuthUser(user),
  });
});
