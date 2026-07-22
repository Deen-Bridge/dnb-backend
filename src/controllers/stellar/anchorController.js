// controllers/stellar/anchorController.js
import User from "../../models/User.js";
import AnchorTransaction from "../../models/AnchorTransaction.js";
import {
  getAnchorInfo,
  fetchAndValidateChallenge,
  submitChallengeResponse,
  storeAnchorJwt,
  getStoredAnchorJwt,
  startInteractiveFlow,
  fetchAnchorTransactionStatus,
  mapAnchorTransactionFields,
  isAnchorConfigured,
  ANCHOR_TERMINAL_STATUSES,
} from "../../services/stellar/anchorService.js";
import {
  getAccountBalance,
  buildChangeTrustTransaction,
} from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";

/**
 * Resolve anchor info: allowlist check, stellar.toml, issuer verification, SEP-24 /info
 * GET /api/stellar/anchor/info?homeDomain=...
 */
export const getInfo = async (req, res) => {
  try {
    if (!isAnchorConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Anchor integration is not available right now. Please try again later.",
      });
    }

    const { homeDomain } = req.query;
    if (!homeDomain) {
      return res
        .status(400)
        .json({ success: false, message: "homeDomain is required" });
    }

    const info = await getAnchorInfo(homeDomain);
    res.status(200).json({ success: true, anchor: info });
  } catch (error) {
    logger.error("Get anchor info error:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.isOperational
        ? error.message
        : "Failed to fetch anchor info",
    });
  }
};

/**
 * Fetch and fully validate a SEP-10 challenge before returning it for signing
 * POST /api/stellar/anchor/auth/challenge
 */
export const requestChallenge = async (req, res) => {
  try {
    if (!isAnchorConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Anchor integration is not available right now. Please try again later.",
      });
    }

    const { homeDomain } = req.body;
    if (!homeDomain) {
      return res
        .status(400)
        .json({ success: false, message: "homeDomain is required" });
    }

    const user = await User.findById(req.user._id).select("stellarWallet");
    if (!user?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    const { challengeXdr, networkPassphrase, webAuthEndpoint } =
      await fetchAndValidateChallenge({
        homeDomain,
        account: user.stellarWallet.publicKey,
      });

    res.status(200).json({
      success: true,
      challenge: {
        xdr: challengeXdr,
        networkPassphrase,
        homeDomain,
        webAuthEndpoint,
      },
    });
  } catch (error) {
    logger.error("Request anchor challenge error:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.isOperational
        ? error.message
        : "Failed to fetch anchor challenge",
    });
  }
};

/**
 * Submit a client-signed SEP-10 challenge and store the resulting anchor
 * JWT server-side. The JWT itself is never included in this (or any) API
 * response - it lives only in Redis, keyed by (userId, homeDomain).
 * POST /api/stellar/anchor/auth/verify
 */
export const verifyChallenge = async (req, res) => {
  try {
    if (!isAnchorConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Anchor integration is not available right now. Please try again later.",
      });
    }

    const { homeDomain, signedXdr } = req.body;
    if (!homeDomain || !signedXdr) {
      return res.status(400).json({
        success: false,
        message: "homeDomain and signedXdr are required",
      });
    }

    const { token, exp } = await submitChallengeResponse({ homeDomain, signedXdr });
    await storeAnchorJwt(req.user._id.toString(), homeDomain, token, exp);

    logger.info(
      `Anchor session established for user ${req.user._id} with ${homeDomain}`
    );

    res.status(200).json({
      success: true,
      message: "Anchor authentication successful",
    });
  } catch (error) {
    logger.error("Verify anchor challenge error:", error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.isOperational
        ? error.message
        : "Failed to verify anchor challenge",
    });
  }
};

/**
 * Shared logic for starting a SEP-24 interactive deposit or withdrawal.
 * Trustline handling (changeTrust XDR) only applies to deposits.
 */
const initiateInteractiveFlow = async (req, res, kind) => {
  try {
    if (!isAnchorConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Anchor integration is not available right now. Please try again later.",
      });
    }

    const { homeDomain } = req.body;
    if (!homeDomain) {
      return res
        .status(400)
        .json({ success: false, message: "homeDomain is required" });
    }

    const user = await User.findById(req.user._id).select("stellarWallet");
    if (!user?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }
    const publicKey = user.stellarWallet.publicKey;

    const jwtToken = await getStoredAnchorJwt(req.user._id.toString(), homeDomain);
    if (!jwtToken) {
      return res.status(401).json({
        success: false,
        message: `Your session with '${homeDomain}' has expired or was never established. Please authenticate with this anchor again.`,
        requiresReauth: true,
      });
    }

    const anchorInfo = await getAnchorInfo(homeDomain);

    const { url, id } = await startInteractiveFlow({
      transferServer: anchorInfo.transferServer,
      jwtToken,
      kind,
      account: publicKey,
      assetCode: "USDC",
    });

    await AnchorTransaction.create({
      user: req.user._id,
      homeDomain,
      kind,
      anchorTransactionId: id,
      assetCode: "USDC",
      status: "incomplete",
      interactiveUrl: url,
    });

    let trustlineXdr;
    if (kind === "deposit") {
      const balance = await getAccountBalance(publicKey);
      if (!balance.hasTrustline) {
        const trustlineTx = await buildChangeTrustTransaction({ publicKey });
        trustlineXdr = trustlineTx.xdr;
      }
    }

    res.status(200).json({
      success: true,
      [kind]: {
        url,
        id,
        ...(trustlineXdr && { trustlineXdr }),
      },
    });
  } catch (error) {
    logger.error(`Initiate anchor ${kind} error:`, error);
    res.status(error.statusCode || 500).json({
      success: false,
      message: error.isOperational
        ? error.message
        : `Failed to start ${kind} with the anchor`,
    });
  }
};

/**
 * POST /api/stellar/anchor/deposits
 */
export const initiateDeposit = (req, res) => initiateInteractiveFlow(req, res, "deposit");

/**
 * POST /api/stellar/anchor/withdrawals
 */
export const initiateWithdrawal = (req, res) => initiateInteractiveFlow(req, res, "withdrawal");

// A record read after this long without a poll is refreshed live on read.
const LIVE_REFRESH_STALE_MS = 60 * 1000;

/**
 * List the requesting user's own anchor transactions, paginated.
 * GET /api/stellar/anchor/transactions
 */
export const getTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const query = { user: req.user._id };

    const transactions = await AnchorTransaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit));
    const total = await AnchorTransaction.countDocuments(query);

    res.status(200).json({
      success: true,
      transactions,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Get anchor transactions error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch anchor transactions",
    });
  }
};

/**
 * Fetch a single anchor transaction owned by the requesting user, refreshing
 * it live from the anchor first if it's non-terminal and stale.
 * GET /api/stellar/anchor/transactions/:id
 */
export const getTransactionById = async (req, res) => {
  try {
    const { id } = req.params;
    // Scoping the lookup to `user: req.user._id` is what makes this an
    // ownership check: another user's transaction simply won't match and
    // this returns a generic 404, same as Transaction/cancelTransaction.
    const transaction = await AnchorTransaction.findOne({
      _id: id,
      user: req.user._id,
    });

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Anchor transaction not found",
      });
    }

    const isTerminal = ANCHOR_TERMINAL_STATUSES.includes(transaction.status);
    const isStale =
      !transaction.lastPolledAt ||
      Date.now() - transaction.lastPolledAt.getTime() > LIVE_REFRESH_STALE_MS;

    if (!isTerminal && isStale) {
      try {
        const jwtToken = await getStoredAnchorJwt(
          req.user._id.toString(),
          transaction.homeDomain
        );
        if (jwtToken) {
          const anchorInfo = await getAnchorInfo(transaction.homeDomain);
          const tx = await fetchAnchorTransactionStatus({
            transferServer: anchorInfo.transferServer,
            jwtToken,
            anchorTransactionId: transaction.anchorTransactionId,
          });
          Object.assign(transaction, mapAnchorTransactionFields(tx));
          transaction.lastPolledAt = new Date();
          await transaction.save();
        }
      } catch (error) {
        // A failed live refresh isn't fatal - fall through and return the
        // last known state rather than erroring the read.
        logger.warn(`Live refresh failed for anchor transaction ${id}:`, error);
      }
    }

    res.status(200).json({ success: true, transaction });
  } catch (error) {
    logger.error("Get anchor transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch anchor transaction",
    });
  }
};
