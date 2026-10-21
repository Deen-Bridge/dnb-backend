import mongoose from "mongoose";
import Transaction from "../../models/Transaction.js";
import Course from "../../models/Course.js";
import Book from "../../models/Book.js";

/**
 * Parse date range inputs into concrete Date bounds.
 */
export const parseDateRange = (startDate?: string | Date, endDate?: string | Date) => {
  const toDate = (value: any) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { start: toDate(startDate), end: toDate(endDate) };
};

/**
 * Get comprehensive revenue analytics for an educator.
 */
export const getEducatorRevenueAnalytics = async (educatorId: string, options: { startDate?: string | Date; endDate?: string | Date; period?: string } = {}) => {
  const creatorObjectId = new mongoose.Types.ObjectId(educatorId);
  const { start, end } = parseDateRange(options.startDate, options.endDate);
  const period = options.period || "month"; // day, week, month

  const matchQuery: any = {
    creator: creatorObjectId,
    status: "confirmed",
    type: "purchase",
  };

  if (start || end) {
    matchQuery.createdAt = {};
    if (start) matchQuery.createdAt.$gte = start;
    if (end) matchQuery.createdAt.$lte = end;
  }

  // 1. Breakdown by item (course or book)
  const itemBreakdownPipeline = [
    { $match: matchQuery },
    {
      $group: {
        _id: { itemId: "$itemId", itemType: "$itemType", itemTitle: "$itemTitle" },
        revenueNumeric: { $sum: { $toDecimal: { $ifNull: ["$amount", "0"] } } },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        itemId: "$_id.itemId",
        itemType: "$_id.itemType",
        title: "$_id.itemTitle",
        revenue: { $toString: "$revenueNumeric" },
        transactionCount: 1,
        averageTransactionValue: {
          $toString: {
            $divide: ["$revenueNumeric", "$transactionCount"],
          },
        },
      },
    },
    { $sort: { revenueNumeric: -1 } },
  ];

  const itemRows = await Transaction.aggregate(itemBreakdownPipeline);

  const courses: any[] = [];
  const books: any[] = [];

  for (const row of itemRows) {
    const entry = {
      itemId: row.itemId,
      title: row.title || "Untitled",
      revenue: row.revenue || "0",
      transactionCount: row.transactionCount || 0,
      averageTransactionValue: row.averageTransactionValue || "0",
    };
    if (row.itemType === "course") {
      courses.push(entry);
    } else if (row.itemType === "book") {
      books.push(entry);
    }
  }

  // 2. Revenue trends over time (daily, weekly, monthly)
  let dateFormat = "%Y-%m-%d";
  if (period === "week") dateFormat = "%G-W%V";
  if (period === "month") dateFormat = "%Y-%m";

  const timeSeriesPipeline = [
    { $match: matchQuery },
    {
      $group: {
        _id: {
          $dateToString: {
            format: dateFormat,
            date: "$createdAt",
            timezone: "UTC",
          },
        },
        revenueNumeric: { $sum: { $toDecimal: { $ifNull: ["$amount", "0"] } } },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        period: "$_id",
        revenue: { $toString: "$revenueNumeric" },
        transactionCount: 1,
        averageTransactionValue: {
          $toString: {
            $divide: ["$revenueNumeric", "$transactionCount"],
          },
        },
      },
    },
    { $sort: { period: 1 } },
  ];

  const timeSeries = await Transaction.aggregate(timeSeriesPipeline);

  // 3. Totals summary
  const totalsPipeline = [
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalRevenueNumeric: { $sum: { $toDecimal: { $ifNull: ["$amount", "0"] } } },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        totalRevenue: { $toString: "$totalRevenueNumeric" },
        transactionCount: 1,
        averageTransactionValue: {
          $cond: {
            if: { $eq: ["$transactionCount", 0] },
            then: "0",
            else: { $toString: { $divide: ["$totalRevenueNumeric", "$transactionCount"] } },
          },
        },
      },
    },
  ];

  const totalsResult = await Transaction.aggregate(totalsPipeline);
  const totals = totalsResult[0] || {
    totalRevenue: "0",
    transactionCount: 0,
    averageTransactionValue: "0",
  };

  return {
    educatorId,
    currency: "USDC",
    totals,
    courses,
    books,
    timeSeries,
  };
};

export default {
  getEducatorRevenueAnalytics,
  parseDateRange,
};
