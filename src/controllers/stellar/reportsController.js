/**
 * @module controllers/stellar/reportsController
 * @description Controller for financial reports endpoints. Provides
 * handlers for generating monthly, quarterly, and custom period reports.
 */

import {
  generateFinancialReport,
  generateMonthlyComparison,
  getDailyRevenue,
  getPeriodDates,
} from "../../services/stellar/reportsService.js";
import logger from "../../config/logger.js";

/**
 * Generate a financial report for a specified period.
 *
 * @route GET /api/stellar/reports
 * @query {string} period - Period type: monthly, quarterly, yearly, custom
 * @query {number} [year] - Year for the report
 * @query {number} [month] - Month number (1-12) for monthly reports
 * @query {number} [quarter] - Quarter number (1-4) for quarterly reports
 * @query {string} [startDate] - ISO date for custom period start
 * @query {string} [endDate] - ISO date for custom period end
 * @query {string} [format=json] - Response format: json or pdf
 */
export const getFinancialReport = async (req, res) => {
  try {
    const {
      period = "monthly",
      year,
      month,
      quarter,
      startDate,
      endDate,
      format = "json",
    } = req.query;

    // Validate period type
    const validPeriods = ["monthly", "quarterly", "yearly", "custom"];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        success: false,
        message: `Invalid period. Must be one of: ${validPeriods.join(", ")}`,
      });
    }

    // Build options
    const options = { period };

    if (year) options.year = parseInt(year, 10);

    if (period === "monthly" && month) {
      options.periodNumber = parseInt(month, 10);
      if (options.periodNumber < 1 || options.periodNumber > 12) {
        return res.status(400).json({
          success: false,
          message: "Month must be between 1 and 12",
        });
      }
    }

    if (period === "quarterly" && quarter) {
      options.periodNumber = parseInt(quarter, 10);
      if (options.periodNumber < 1 || options.periodNumber > 4) {
        return res.status(400).json({
          success: false,
          message: "Quarter must be between 1 and 4",
        });
      }
    }

    if (period === "custom") {
      if (!startDate || !endDate) {
        return res.status(400).json({
          success: false,
          message: "Custom period requires startDate and endDate",
        });
      }
      options.startDate = new Date(startDate);
      options.endDate = new Date(endDate);

      if (isNaN(options.startDate.getTime()) || isNaN(options.endDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: "Invalid date format. Use ISO format (YYYY-MM-DD)",
        });
      }

      if (options.startDate > options.endDate) {
        return res.status(400).json({
          success: false,
          message: "startDate must be before endDate",
        });
      }
    }

    const report = await generateFinancialReport(options);

    // TODO: PDF export support (requires template rendering)
    if (format === "pdf") {
      return res.status(501).json({
        success: false,
        message: "PDF export not yet implemented",
      });
    }

    res.status(200).json({
      success: true,
      data: report,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Failed to generate financial report");
    res.status(500).json({
      success: false,
      message: "Failed to generate financial report",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get monthly comparison report.
 *
 * @route GET /api/stellar/reports/comparison
 * @query {number} [months=3] - Number of months to compare (max 12)
 */
export const getMonthlyComparison = async (req, res) => {
  try {
    let months = parseInt(req.query.months, 10) || 3;
    months = Math.min(Math.max(months, 1), 12); // Clamp 1-12

    const comparison = await generateMonthlyComparison(months);

    res.status(200).json({
      success: true,
      data: comparison,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Failed to generate monthly comparison");
    res.status(500).json({
      success: false,
      message: "Failed to generate comparison report",
    });
  }
};

/**
 * Get daily revenue data for charts.
 *
 * @route GET /api/stellar/reports/daily
 * @query {string} [startDate] - Start date (defaults to 30 days ago)
 * @query {string} [endDate] - End date (defaults to today)
 */
export const getDailyRevenueData = async (req, res) => {
  try {
    let { startDate, endDate } = req.query;

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate
      ? new Date(startDate)
      : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return res.status(400).json({
        success: false,
        message: "Invalid date format",
      });
    }

    // Set end to end of day
    end.setHours(23, 59, 59, 999);

    const data = await getDailyRevenue(start, end);

    res.status(200).json({
      success: true,
      data: {
        period: {
          startDate: start,
          endDate: end,
        },
        daily: data,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get daily revenue data");
    res.status(500).json({
      success: false,
      message: "Failed to get daily revenue data",
    });
  }
};

/**
 * Get summary statistics for dashboard.
 *
 * @route GET /api/stellar/reports/summary
 * @query {string} [period=monthly] - Period for summary
 */
export const getReportSummary = async (req, res) => {
  try {
    const period = req.query.period || "monthly";

    // Get current period
    const currentReport = await generateFinancialReport({ period });

    // Get previous period for comparison
    const now = new Date();
    let previousOptions = { period };

    if (period === "monthly") {
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      previousOptions.year = prevMonth.getFullYear();
      previousOptions.periodNumber = prevMonth.getMonth() + 1;
    } else if (period === "quarterly") {
      const currentQuarter = Math.ceil((now.getMonth() + 1) / 3);
      const prevQuarter = currentQuarter === 1 ? 4 : currentQuarter - 1;
      previousOptions.year = currentQuarter === 1 ? now.getFullYear() - 1 : now.getFullYear();
      previousOptions.periodNumber = prevQuarter;
    }

    const previousReport = await generateFinancialReport(previousOptions);

    // Calculate changes
    const changes = {};
    const metricsToCompare = ["grossRevenue", "netRevenue", "totalTransactions", "platformFees"];

    for (const metric of metricsToCompare) {
      const current = currentReport.metrics[metric] || 0;
      const previous = previousReport.metrics[metric] || 0;
      const change = previous > 0 ? ((current - previous) / previous) * 100 : 0;
      changes[metric] = {
        current,
        previous,
        changePercent: Math.round(change * 100) / 100,
        direction: change >= 0 ? "up" : "down",
      };
    }

    res.status(200).json({
      success: true,
      data: {
        currentPeriod: currentReport.period.label,
        previousPeriod: previousReport.period.label,
        summary: currentReport.summary,
        changes,
        breakdown: {
          byType: currentReport.breakdown.revenue.byType,
          byItemType: currentReport.breakdown.revenue.byItemType,
        },
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get report summary");
    res.status(500).json({
      success: false,
      message: "Failed to get report summary",
    });
  }
};

/**
 * Export report data.
 *
 * @route GET /api/stellar/reports/export
 * @query {string} format - Export format: json, csv
 * @query {string} period - Period type
 */
export const exportReport = async (req, res) => {
  try {
    const { format = "json", period = "monthly", year, month, quarter } = req.query;

    const options = { period };
    if (year) options.year = parseInt(year, 10);
    if (month) options.periodNumber = parseInt(month, 10);
    if (quarter) options.periodNumber = parseInt(quarter, 10);

    const report = await generateFinancialReport(options);

    if (format === "csv") {
      // Generate CSV
      const csvRows = [
        ["Metric", "Value"],
        ["Report ID", report.reportId],
        ["Period", report.period.label],
        ["Generated At", report.generatedAt.toISOString()],
        [""],
        ["Summary"],
        ["Gross Revenue", report.summary.grossRevenue],
        ["Net Revenue", report.summary.netRevenue],
        ["Platform Fees", report.summary.platformFees],
        ["Refunded Amount", report.summary.refundedAmount],
        ["Total Transactions", report.summary.totalTransactions],
        [""],
        ["Key Metrics"],
        ["Purchase Revenue", report.metrics.purchaseRevenue],
        ["Donation Revenue", report.metrics.donationRevenue],
        ["Purchase Count", report.metrics.purchaseCount],
        ["Donation Count", report.metrics.donationCount],
        ["Average Transaction Value", report.metrics.avgTransactionValue],
        ["Refund Rate", report.metrics.refundRate],
        ["Refund Count", report.metrics.refundCount],
        ["Sponsorship Costs", report.metrics.sponsorshipCosts],
      ];

      const csvContent = csvRows.map((row) => row.join(",")).join("\n");

      res.setHeader("Content-Type", "text/csv");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="financial-report-${report.period.label.replace(/\s+/g, "-")}.csv"`
      );
      return res.send(csvContent);
    }

    // Default JSON export
    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="financial-report-${report.period.label.replace(/\s+/g, "-")}.json"`
    );
    res.json(report);
  } catch (error) {
    logger.error({ error: error.message }, "Failed to export report");
    res.status(500).json({
      success: false,
      message: "Failed to export report",
    });
  }
};
