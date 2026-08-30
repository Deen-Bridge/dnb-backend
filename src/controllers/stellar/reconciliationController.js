import { getReconciliationStatus } from "../../services/stellar/reconciliationService.js";
import logger from "../../config/logger.js";

export const reconciliationStatus = async (req, res) => {
  try {
    const status = await getReconciliationStatus();
    res.status(200).json({
      success: true,
      ...status,
    });
  } catch (error) {
    logger.error("Get reconciliation status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch reconciliation status",
    });
  }
};
