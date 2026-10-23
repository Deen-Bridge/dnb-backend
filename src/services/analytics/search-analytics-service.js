import mongoose from "mongoose";
import SearchAnalyticsEvent from "../../models/search-analytics-event.js";
import logger from "../../config/logger.js";

/**
 * Log a search event.
 */
export const logSearchEvent = async (eventData) => {
  try {
    const event = await SearchAnalyticsEvent.create(eventData);
    return event;
  } catch (error) {
    logger.error("Failed to log search event:", error);
    return null;
  }
};

/**
 * Get top search queries by frequency.
 */
export const getTopSearchQueries = async (filters = {}) => {
  const { startDate, endDate, type, limit = 20, page = 1 } = filters;

  const matchStage = {};
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }
  if (type) matchStage.type = type;

  const validLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const validPage = Math.max(1, Number(page) || 1);
  const skip = (validPage - 1) * validLimit;

  const pipeline = [
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    {
      $group: {
        _id: { $toLower: "$query" },
        count: { $sum: 1 },
        lastSearched: { $max: "$createdAt" },
        uniqueUsers: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        query: "$_id",
        count: 1,
        lastSearched: 1,
        uniqueUsers: { $size: "$uniqueUsers" },
      },
    },
    { $sort: { count: -1 } },
    { $skip: skip },
    { $limit: validLimit },
  ];

  const [results, countResult] = await Promise.all([
    SearchAnalyticsEvent.aggregate(pipeline),
    SearchAnalyticsEvent.aggregate([
      ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
      {
        $group: {
          _id: { $toLower: "$query" },
        },
      },
      { $count: "total" },
    ]),
  ]);

  const total = countResult[0]?.total || 0;

  return {
    queries: results,
    pagination: {
      total,
      page: validPage,
      limit: validLimit,
      pages: Math.ceil(total / validLimit),
    },
  };
};

/**
 * Get zero-result searches (queries that returned no results).
 */
export const getZeroResultSearches = async (filters = {}) => {
  const { startDate, endDate, type, limit = 20, page = 1 } = filters;

  const matchStage = { hasResults: false };
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }
  if (type) matchStage.type = type;

  const validLimit = Math.min(100, Math.max(1, Number(limit) || 20));
  const validPage = Math.max(1, Number(page) || 1);
  const skip = (validPage - 1) * validLimit;

  const pipeline = [
    { $match: matchStage },
    {
      $group: {
        _id: { $toLower: "$query" },
        count: { $sum: 1 },
        lastSearched: { $max: "$createdAt" },
      },
    },
    {
      $project: {
        query: "$_id",
        count: 1,
        lastSearched: 1,
      },
    },
    { $sort: { count: -1 } },
    { $skip: skip },
    { $limit: validLimit },
  ];

  const [results, countResult] = await Promise.all([
    SearchAnalyticsEvent.aggregate(pipeline),
    SearchAnalyticsEvent.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $toLower: "$query" },
        },
      },
      { $count: "total" },
    ]),
  ]);

  const total = countResult[0]?.total || 0;

  return {
    queries: results,
    pagination: {
      total,
      page: validPage,
      limit: validLimit,
      pages: Math.ceil(total / validLimit),
    },
  };
};

/**
 * Get search analytics summary.
 */
export const getSearchSummary = async (filters = {}) => {
  const { startDate, endDate } = filters;

  const matchStage = {};
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  const pipeline = [
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    {
      $group: {
        _id: null,
        totalSearches: { $sum: 1 },
        uniqueQueries: { $addToSet: { $toLower: "$query" } },
        uniqueUsers: { $addToSet: "$userId" },
        zeroResultSearches: {
          $sum: { $cond: ["$hasResults", 0, 1] },
        },
        searchesWithResults: {
          $sum: { $cond: ["$hasResults", 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalSearches: 1,
        uniqueQueries: { $size: "$uniqueQueries" },
        uniqueUsers: { $size: "$uniqueUsers" },
        zeroResultSearches: 1,
        searchesWithResults: 1,
        zeroResultRate: {
          $cond: [
            { $eq: ["$totalSearches", 0] },
            0,
            {
              $round: [
                {
                  $multiply: [
                    { $divide: ["$zeroResultSearches", "$totalSearches"] },
                    100,
                  ],
                },
                2,
              ],
            },
          ],
        },
      },
    },
  ];

  const [result] = await SearchAnalyticsEvent.aggregate(pipeline);
  return result || {
    totalSearches: 0,
    uniqueQueries: 0,
    uniqueUsers: 0,
    zeroResultSearches: 0,
    searchesWithResults: 0,
    zeroResultRate: 0,
  };
};

/**
 * Get search trends (searches per day over time).
 */
export const getSearchTrends = async (filters = {}) => {
  const { startDate, endDate, type } = filters;

  const matchStage = {};
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }
  if (type) matchStage.type = type;

  const pipeline = [
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    {
      $group: {
        _id: {
          date: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          hasResults: "$hasResults",
        },
        count: { $sum: 1 },
      },
    },
    {
      $group: {
        _id: "$_id.date",
        total: { $sum: "$count" },
        withResults: {
          $sum: { $cond: ["$_id.hasResults", "$count", 0] },
        },
        zeroResults: {
          $sum: { $cond: ["$_id.hasResults", 0, "$count"] },
        },
      },
    },
    { $sort: { _id: 1 } },
  ];

  return SearchAnalyticsEvent.aggregate(pipeline);
};

export default {
  logSearchEvent,
  getTopSearchQueries,
  getZeroResultSearches,
  getSearchSummary,
  getSearchTrends,
};
