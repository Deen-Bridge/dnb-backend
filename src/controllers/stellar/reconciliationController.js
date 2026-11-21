import { getReconciliationStatus } from "../../services/stellar/reconciliationHealthService.js";
import { ERROR_CODES, buildErrorResponse } from "../../config/errorCodes.js";
import logger from "../../config/logger.js";

/**
 * GET /api/stellar/payment/reconciliation/status (admin).
 *
 * Always 200 when the status could be computed, whatever the reported state:
 * this is a report for operators, not a probe. A 503 means the status itself
 * is unknown and should be treated as such by dashboards and alerts.
 */
export const reconciliationStatus = async (req, res) => {
  // Operational data about payment flow; never let a proxy keep a copy.
  res.set("Cache-Control", "no-store");

  try {
    const status = await getReconciliationStatus();
    res.status(200).json({ success: true, reconciliation: status });
  } catch (error) {
    logger.error({ err: error?.message }, "Get reconciliation status error");
    res.status(503).json(
      buildErrorResponse(
        ERROR_CODES.DATABASE_ERROR,
        "Reconciliation status is temporarily unavailable",
        undefined,
        503
      )
    );
  }
};
