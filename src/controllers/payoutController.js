// controllers/payoutController.js
import {
  buildPayoutBatch,
  submitPayoutBatch,
  getEducatorBalance,
  getEducatorStatement,
  getEducatorHistory,
} from "../services/payoutService.js";
import logger from "../config/logger.js";

/**
 * TODO: Replace with centralized RBAC system once open RBAC issue is completed.
 * Helper to check if a user is an authorized payout operator.
 */
export const isPayoutAdmin = (user) => {
  if (!user || !user._id) return false;
  const allowlist = (process.env.PAYOUT_ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return allowlist.includes(user._id.toString());
};

/**
 * Build batch payout transaction XDRs or simulate dry-run plan
 * POST /api/payouts/build
 */
export const buildBatch = async (req, res) => {
  try {
    if (!isPayoutAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not authorized as payout operator",
      });
    }

    const { educatorIds, minAmount, dryRun } = req.body;

    const result = await buildPayoutBatch({
      educatorIds,
      minAmount,
      dryRun: Boolean(dryRun),
      adminId: req.user._id,
    });

    if (dryRun) {
      return res.status(200).json({
        success: true,
        message: "Dry-run plan built successfully",
        ...result,
      });
    }

    if (!result.success) {
      return res.status(400).json(result);
    }

    res.status(200).json({
      success: true,
      message: "Payout batch built successfully",
      batchId: result.batchId,
      status: result.status,
      totalRecipients: result.totalRecipients,
      totalAmount: result.totalAmount,
      totalStroops: result.totalStroops,
      recipients: result.recipients,
      skipped: result.skipped,
      chunks: result.chunks,
    });
  } catch (error) {
    logger.error("Build payout batch error:", error);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to build payout batch",
    });
  }
};

/**
 * Submit signed batch XDRs and settle balances
 * POST /api/payouts/:batchId/submit
 */
export const submitBatch = async (req, res) => {
  try {
    if (!isPayoutAdmin(req.user)) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Not authorized as payout operator",
      });
    }

    const { batchId } = req.params;
    const { signedXdrs, signedXdr } = req.body;

    const xdrs = signedXdrs || signedXdr;
    if (!xdrs) {
      return res.status(400).json({
        success: false,
        message: "Signed XDR(s) are required",
      });
    }

    const result = await submitPayoutBatch({
      batchId,
      signedXdrs: xdrs,
      adminId: req.user._id,
    });

    res.status(200).json({
      success: true,
      message: "Payout batch submitted and settled successfully",
      ...result,
    });
  } catch (error) {
    logger.error(`Submit payout batch ${req.params.batchId} error:`, error);
    res.status(400).json({
      success: false,
      message: error.message || "Failed to submit payout batch",
    });
  }
};

/**
 * Get current educator's balance
 * GET /api/payouts/me/balance
 */
export const getMyBalance = async (req, res) => {
  try {
    const balance = await getEducatorBalance(req.user._id);
    res.status(200).json({
      success: true,
      balance,
    });
  } catch (error) {
    logger.error("Get educator balance error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch balance",
    });
  }
};

/**
 * Get current educator's statement
 * GET /api/payouts/me/statement
 */
export const getMyStatement = async (req, res) => {
  try {
    const { from, to } = req.query;
    const statement = await getEducatorStatement(req.user._id, { from, to });
    res.status(200).json({
      success: true,
      statement,
    });
  } catch (error) {
    logger.error("Get educator statement error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch statement",
    });
  }
};

/**
 * Get current educator's payout history
 * GET /api/payouts/me/history
 */
export const getMyHistory = async (req, res) => {
  try {
    const history = await getEducatorHistory(req.user._id);
    res.status(200).json({
      success: true,
      history,
    });
  } catch (error) {
    logger.error("Get educator history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch payout history",
    });
  }
};
