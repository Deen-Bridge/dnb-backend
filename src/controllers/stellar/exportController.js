// controllers/stellar/exportController.js
import { parseFilters, generateExport } from "../../services/stellar/exportService.js";
import logger from "../../config/logger.js";

/**
 * Transaction export controller (#163).
 *
 * Exposes the authenticated user's transaction history as a downloadable CSV
 * file or PDF report, scoped to transactions where the user is the buyer or the
 * creator. Supports `?format=csv|pdf` plus `startDate`, `endDate`, and `status`
 * filters. Both formats include summary totals/statistics.
 *
 * The PDF is produced by a hand-rolled, dependency-free writer in
 * exportService.js (no pdfkit/handlebars added) and is returned with
 * `Content-Type: application/pdf`.
 */

/**
 * Normalize and validate the requested output format.
 * @param {*} raw - the `format` query value
 * @returns {"csv"|"pdf"|null} the format, or null when unsupported
 */
function normalizeFormat(raw) {
  const value = String(raw || "csv").toLowerCase();
  return value === "csv" || value === "pdf" ? value : null;
}

/**
 * Export the authenticated user's transactions.
 * GET /api/stellar/export/transactions?format=csv|pdf&startDate=&endDate=&status=
 *
 * @param {import("express").Request} req - authenticated request (`req.user`)
 * @param {import("express").Response} res - Express response
 * @returns {Promise<void>}
 */
export const exportTransactions = async (req, res) => {
  try {
    const userId = req.user._id;

    const format = normalizeFormat(req.query.format);
    if (!format) {
      return res.status(400).json({
        success: false,
        message: "Invalid format. Supported values: csv, pdf",
      });
    }

    let filters;
    try {
      filters = parseFilters(req.query);
    } catch (filterError) {
      return res.status(400).json({
        success: false,
        message: filterError.message,
      });
    }

    const result = await generateExport({ userId, format, filters });

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `dnb-transactions-${stamp}.${result.extension}`;

    res.setHeader("Content-Type", result.contentType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${filename}"`
    );
    // Expose counts so a client can show a quick confirmation without parsing.
    res.setHeader("X-Export-Record-Count", String(result.count));

    logger.info(
      { userId: String(userId), format, count: result.count },
      "Transaction export delivered"
    );

    return res.status(200).send(result.body);
  } catch (error) {
    logger.error("Export transactions error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to export transactions",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Return the export summary statistics as JSON without generating a file. Useful
 * for previewing totals before downloading, and honours the same filters.
 * GET /api/stellar/export/summary?startDate=&endDate=&status=
 *
 * @param {import("express").Request} req - authenticated request (`req.user`)
 * @param {import("express").Response} res - Express response
 * @returns {Promise<void>}
 */
export const exportSummary = async (req, res) => {
  try {
    const userId = req.user._id;

    let filters;
    try {
      filters = parseFilters(req.query);
    } catch (filterError) {
      return res.status(400).json({
        success: false,
        message: filterError.message,
      });
    }

    // Reuse the CSV path purely to compute the summary + count consistently.
    const result = await generateExport({ userId, format: "csv", filters });

    return res.status(200).json({
      success: true,
      count: result.count,
      summary: result.summary,
    });
  } catch (error) {
    logger.error("Export summary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to compute export summary",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
