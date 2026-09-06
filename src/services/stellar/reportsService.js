/**
 * @module services/stellar/reportsService
 * @description Service for generating comprehensive financial reports on
 * monthly and quarterly basis. Aggregates revenue, expenses, and key
 * financial metrics for business intelligence and compliance.
 */

import Transaction from "../../models/Transaction.js";
import LedgerEntry from "../../models/LedgerEntry.js";
import Refund from "../../models/Refund.js";
import logger from "../../config/logger.js";

/**
 * Period types for reports.
 * @typedef {"monthly"|"quarterly"|"yearly"|"custom"} ReportPeriod
 */

/**
 * Get start and end dates for a period.
 *
 * @param {ReportPeriod} period - Period type.
 * @param {number} [year] - Year (defaults to current).
 * @param {number} [periodNumber] - Month (1-12) or quarter (1-4).
 * @returns {{startDate: Date, endDate: Date, label: string}}
 */
export const getPeriodDates = (period, year, periodNumber) => {
  const now = new Date();
  const targetYear = year || now.getFullYear();

  switch (period) {
    case "monthly": {
      const month = (periodNumber || now.getMonth() + 1) - 1; // 0-indexed
      const startDate = new Date(targetYear, month, 1);
      const endDate = new Date(targetYear, month + 1, 0, 23, 59, 59, 999);
      const label = startDate.toLocaleString("default", { month: "long", year: "numeric" });
      return { startDate, endDate, label };
    }
    case "quarterly": {
      const quarter = periodNumber || Math.ceil((now.getMonth() + 1) / 3);
      const startMonth = (quarter - 1) * 3;
      const startDate = new Date(targetYear, startMonth, 1);
      const endDate = new Date(targetYear, startMonth + 3, 0, 23, 59, 59, 999);
      const label = `Q${quarter} ${targetYear}`;
      return { startDate, endDate, label };
    }
    case "yearly": {
      const startDate = new Date(targetYear, 0, 1);
      const endDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
      const label = `${targetYear}`;
      return { startDate, endDate, label };
    }
    default:
      throw new Error(`Invalid period type: ${period}`);
  }
};

/**
 * Aggregate transaction revenue by various dimensions.
 *
 * @param {Date} startDate - Start of period.
 * @param {Date} endDate - End of period.
 * @returns {Promise<object>} Revenue breakdown.
 */
export const aggregateRevenue = async (startDate, endDate) => {
  const matchStage = {
    status: "confirmed",
    confirmedAt: { $gte: startDate, $lte: endDate },
  };

  // Revenue by transaction type (purchase vs donation)
  const byType = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$type",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  // Revenue by item type (book vs course) for purchases only
  const byItemType = await Transaction.aggregate([
    { $match: { ...matchStage, type: "purchase" } },
    {
      $group: {
        _id: "$itemType",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  // Revenue by currency/asset
  const byCurrency = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$currency",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  // Revenue by settlement mode
  const bySettlement = await Transaction.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: "$settlement",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  // Platform fees collected
  const platformFees = await Transaction.aggregate([
    {
      $match: {
        ...matchStage,
        "platformFee.platformAmount": { $exists: true, $ne: null },
      },
    },
    {
      $group: {
        _id: null,
        totalFees: { $sum: { $toDouble: "$platformFee.platformAmount" } },
        totalCreatorAmount: { $sum: { $toDouble: "$platformFee.creatorAmount" } },
        count: { $sum: 1 },
      },
    },
  ]);

  // Sponsored transactions (fee-bump)
  const sponsored = await Transaction.aggregate([
    { $match: { ...matchStage, sponsored: true } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSponsorFees: { $sum: { $toDouble: "$sponsorFeeCharged" } },
      },
    },
  ]);

  return {
    byType: Object.fromEntries(byType.map((r) => [r._id, { count: r.count, amount: r.totalAmount }])),
    byItemType: Object.fromEntries(byItemType.map((r) => [r._id, { count: r.count, amount: r.totalAmount }])),
    byCurrency: Object.fromEntries(byCurrency.map((r) => [r._id, { count: r.count, amount: r.totalAmount }])),
    bySettlement: Object.fromEntries(bySettlement.map((r) => [r._id, { count: r.count, amount: r.totalAmount }])),
    platformFees: platformFees[0] || { totalFees: 0, totalCreatorAmount: 0, count: 0 },
    sponsored: sponsored[0] || { count: 0, totalSponsorFees: 0 },
  };
};

/**
 * Aggregate refund statistics for a period.
 *
 * @param {Date} startDate - Start of period.
 * @param {Date} endDate - End of period.
 * @returns {Promise<object>} Refund statistics.
 */
export const aggregateRefunds = async (startDate, endDate) => {
  const byStatus = await Refund.aggregate([
    { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const confirmed = await Refund.aggregate([
    {
      $match: {
        status: "confirmed",
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  return {
    byStatus: Object.fromEntries(byStatus.map((r) => [r._id, { count: r.count, amount: r.totalAmount }])),
    confirmed: confirmed[0] || { count: 0, totalAmount: 0 },
  };
};

/**
 * Aggregate educator ledger entries for payouts.
 *
 * @param {Date} startDate - Start of period.
 * @param {Date} endDate - End of period.
 * @returns {Promise<object>} Payout statistics.
 */
export const aggregatePayouts = async (startDate, endDate) => {
  const sales = await LedgerEntry.aggregate([
    {
      $match: {
        type: "sale",
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$settlement",
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const payouts = await LedgerEntry.aggregate([
    {
      $match: {
        type: "payout",
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalAmount: { $sum: { $toDouble: "$amount" } },
      },
    },
  ]);

  const topEducators = await LedgerEntry.aggregate([
    {
      $match: {
        type: "sale",
        createdAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: "$educator",
        totalEarnings: { $sum: { $toDouble: "$amount" } },
        saleCount: { $sum: 1 },
      },
    },
    { $sort: { totalEarnings: -1 } },
    { $limit: 10 },
    {
      $lookup: {
        from: "users",
        localField: "_id",
        foreignField: "_id",
        as: "educatorInfo",
      },
    },
    {
      $project: {
        educator: { $arrayElemAt: ["$educatorInfo", 0] },
        totalEarnings: 1,
        saleCount: 1,
      },
    },
    {
      $project: {
        "educator.name": 1,
        "educator.email": 1,
        totalEarnings: 1,
        saleCount: 1,
      },
    },
  ]);

  return {
    salesBySettlement: Object.fromEntries(
      sales.map((r) => [r._id || "direct", { count: r.count, amount: r.totalAmount }])
    ),
    payouts: payouts[0] || { count: 0, totalAmount: 0 },
    topEducators,
  };
};

/**
 * Calculate key financial metrics.
 *
 * @param {object} revenue - Revenue data from aggregateRevenue.
 * @param {object} refunds - Refund data from aggregateRefunds.
 * @param {object} payouts - Payout data from aggregatePayouts.
 * @returns {object} Calculated metrics.
 */
export const calculateMetrics = (revenue, refunds, payouts) => {
  const purchaseRevenue = revenue.byType.purchase?.amount || 0;
  const donationRevenue = revenue.byType.donation?.amount || 0;
  const grossRevenue = purchaseRevenue + donationRevenue;

  const platformFees = revenue.platformFees.totalFees || 0;
  const refundedAmount = refunds.confirmed?.totalAmount || 0;
  const sponsorshipCosts = revenue.sponsored.totalSponsorFees || 0;

  const netRevenue = grossRevenue - refundedAmount;
  const netPlatformFees = platformFees; // Platform keeps these
  const creatorPayments = revenue.platformFees.totalCreatorAmount || 0;

  const purchaseCount = revenue.byType.purchase?.count || 0;
  const donationCount = revenue.byType.donation?.count || 0;
  const totalTransactions = purchaseCount + donationCount;

  const avgTransactionValue = totalTransactions > 0 ? grossRevenue / totalTransactions : 0;
  const refundRate = purchaseCount > 0 ? (refunds.confirmed?.count || 0) / purchaseCount : 0;

  return {
    grossRevenue,
    netRevenue,
    purchaseRevenue,
    donationRevenue,
    platformFees: netPlatformFees,
    creatorPayments,
    refundedAmount,
    sponsorshipCosts,
    totalTransactions,
    purchaseCount,
    donationCount,
    avgTransactionValue,
    refundRate,
    refundCount: refunds.confirmed?.count || 0,
  };
};

/**
 * Generate a comprehensive financial report.
 *
 * @param {object} options - Report options.
 * @param {ReportPeriod} options.period - Period type.
 * @param {number} [options.year] - Year.
 * @param {number} [options.periodNumber] - Month or quarter number.
 * @param {Date} [options.startDate] - Custom start date.
 * @param {Date} [options.endDate] - Custom end date.
 * @returns {Promise<object>} Complete financial report.
 */
export const generateFinancialReport = async (options) => {
  const { period, year, periodNumber, startDate: customStart, endDate: customEnd } = options;

  let startDate, endDate, periodLabel;

  if (customStart && customEnd) {
    startDate = customStart;
    endDate = customEnd;
    periodLabel = `${startDate.toISOString().split("T")[0]} to ${endDate.toISOString().split("T")[0]}`;
  } else {
    const dates = getPeriodDates(period, year, periodNumber);
    startDate = dates.startDate;
    endDate = dates.endDate;
    periodLabel = dates.label;
  }

  logger.info({ period: periodLabel, startDate, endDate }, "Generating financial report");

  const [revenue, refunds, payouts] = await Promise.all([
    aggregateRevenue(startDate, endDate),
    aggregateRefunds(startDate, endDate),
    aggregatePayouts(startDate, endDate),
  ]);

  const metrics = calculateMetrics(revenue, refunds, payouts);

  const report = {
    reportId: `FR-${Date.now()}`,
    generatedAt: new Date(),
    period: {
      type: period || "custom",
      label: periodLabel,
      startDate,
      endDate,
    },
    summary: {
      grossRevenue: metrics.grossRevenue,
      netRevenue: metrics.netRevenue,
      platformFees: metrics.platformFees,
      refundedAmount: metrics.refundedAmount,
      totalTransactions: metrics.totalTransactions,
    },
    metrics,
    breakdown: {
      revenue,
      refunds,
      payouts,
    },
  };

  logger.info(
    { reportId: report.reportId, grossRevenue: metrics.grossRevenue },
    "Financial report generated"
  );

  return report;
};

/**
 * Generate month-over-month comparison report.
 *
 * @param {number} [months=3] - Number of months to compare.
 * @returns {Promise<object>} Monthly comparison data.
 */
export const generateMonthlyComparison = async (months = 3) => {
  const now = new Date();
  const reports = [];

  for (let i = 0; i < months; i++) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    const report = await generateFinancialReport({
      period: "monthly",
      year,
      periodNumber: month,
    });

    reports.push({
      month: report.period.label,
      ...report.metrics,
    });
  }

  return {
    comparison: reports.reverse(),
    trend: calculateTrend(reports),
  };
};

/**
 * Calculate trend from comparison data.
 *
 * @param {Array} reports - Array of report metrics.
 * @returns {object} Trend analysis.
 */
const calculateTrend = (reports) => {
  if (reports.length < 2) return null;

  const latest = reports[reports.length - 1];
  const previous = reports[reports.length - 2];

  const revenueChange = previous.grossRevenue > 0
    ? ((latest.grossRevenue - previous.grossRevenue) / previous.grossRevenue) * 100
    : 0;

  const transactionChange = previous.totalTransactions > 0
    ? ((latest.totalTransactions - previous.totalTransactions) / previous.totalTransactions) * 100
    : 0;

  return {
    revenueChangePercent: Math.round(revenueChange * 100) / 100,
    transactionChangePercent: Math.round(transactionChange * 100) / 100,
    direction: revenueChange >= 0 ? "up" : "down",
  };
};

/**
 * Get daily revenue for charting.
 *
 * @param {Date} startDate - Start date.
 * @param {Date} endDate - End date.
 * @returns {Promise<Array>} Daily revenue data.
 */
export const getDailyRevenue = async (startDate, endDate) => {
  const dailyData = await Transaction.aggregate([
    {
      $match: {
        status: "confirmed",
        confirmedAt: { $gte: startDate, $lte: endDate },
      },
    },
    {
      $group: {
        _id: {
          $dateToString: { format: "%Y-%m-%d", date: "$confirmedAt" },
        },
        revenue: { $sum: { $toDouble: "$amount" } },
        transactions: { $sum: 1 },
        purchases: { $sum: { $cond: [{ $eq: ["$type", "purchase"] }, 1, 0] } },
        donations: { $sum: { $cond: [{ $eq: ["$type", "donation"] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return dailyData.map((d) => ({
    date: d._id,
    revenue: d.revenue,
    transactions: d.transactions,
    purchases: d.purchases,
    donations: d.donations,
  }));
};
