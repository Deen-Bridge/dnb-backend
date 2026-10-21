import mongoose from "mongoose";
import UserJourneyEvent from "../../models/user-journey-event.js";
import logger from "../../config/logger.js";

/**
 * Record a single journey event.
 */
export const recordJourneyEvent = async (eventData) => {
  try {
    const event = await UserJourneyEvent.create(eventData);
    return event;
  } catch (error) {
    logger.error("Failed to record journey event:", error);
    return null;
  }
};

/**
 * Record multiple journey events in bulk.
 */
export const recordBulkJourneyEvents = async (events) => {
  try {
    const result = await UserJourneyEvent.insertMany(events, {
      ordered: false,
    });
    return result;
  } catch (error) {
    logger.error("Failed to bulk record journey events:", error);
    return null;
  }
};

/**
 * Get a user's journey, replaying their events chronologically so the client
 * can reconstruct the exact path they took within a session.
 */
export const getUserJourney = async (filters = {}) => {
  const { userId, sessionId, startDate, endDate, page, limit = 50 } = filters;

  const query = {};
  if (userId) query.userId = new mongoose.Types.ObjectId(userId);
  if (sessionId) query.sessionId = sessionId;
  if (startDate || endDate) {
    query.createdAt = {};
    if (startDate) query.createdAt.$gte = new Date(startDate);
    if (endDate) query.createdAt.$lte = new Date(endDate);
  }

  const safeLimit = Math.min(100, Math.max(1, Number(limit) || 50));
  const safePage = Math.max(1, Number(page) || 1);
  const skip = (safePage - 1) * safeLimit;

  const [events, total] = await Promise.all([
    UserJourneyEvent.find(query)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(safeLimit)
      .lean(),
    UserJourneyEvent.countDocuments(query),
  ]);

  return {
    events,
    pagination: {
      total,
      page: safePage,
      limit: safeLimit,
      pages: Math.ceil(total / safeLimit),
    },
  };
};

/**
 * Get common user flow patterns: the most frequent page-to-page
 * transitions across sessions. Events are ordered by time within each
 * session, and each consecutive pair forms one transition.
 */
export const getFlowPatterns = async (filters = {}) => {
  const { startDate, endDate, limit = 20 } = filters;

  const matchStage = {};
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = new Date(startDate);
    if (endDate) matchStage.createdAt.$lte = new Date(endDate);
  }

  // Group each session's pages in chronological order, keeping only sessions
  // with at least two events (i.e. ones that contain a transition).
  const sessions = await UserJourneyEvent.aggregate([
    ...(Object.keys(matchStage).length > 0 ? [{ $match: matchStage }] : []),
    { $sort: { sessionId: 1, createdAt: 1 } },
    {
      $group: {
        _id: "$sessionId",
        pages: { $push: "$page" },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gte: 2 } } },
    { $limit: 500 },
  ]);

  const transitionCounts = {};
  for (const session of sessions) {
    for (let i = 0; i < session.pages.length - 1; i++) {
      const from = session.pages[i];
      const to = session.pages[i + 1];
      const key = `${from} -> ${to}`;
      transitionCounts[key] = (transitionCounts[key] || 0) + 1;
    }
  }

  return Object.entries(transitionCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.min(50, Number(limit) || 20))
    .map(([transition, count]) => {
      const separator = transition.indexOf(" -> ");
      const from = transition.slice(0, separator);
      const to = transition.slice(separator + 4);
      return { from, to, count };
    });
};

/**
 * Get page visit statistics (visits, unique sessions, unique users per page).
 */
export const getPageStats = async (filters = {}) => {
  const { startDate, endDate, limit = 50 } = filters;

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
        _id: "$page",
        visits: { $sum: 1 },
        uniqueSessions: { $addToSet: "$sessionId" },
        uniqueUsers: { $addToSet: "$userId" },
      },
    },
    {
      $project: {
        page: "$_id",
        visits: 1,
        uniqueSessions: { $size: "$uniqueSessions" },
        uniqueUsers: { $size: "$uniqueUsers" },
      },
    },
    { $sort: { visits: -1 } },
    { $limit: Math.min(100, Number(limit) || 50) },
  ];

  return UserJourneyEvent.aggregate(pipeline);
};

/**
 * Get high-level journey summary metrics.
 */
export const getJourneySummary = async (filters = {}) => {
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
        totalEvents: { $sum: 1 },
        uniqueSessions: { $addToSet: "$sessionId" },
        uniqueUsers: { $addToSet: "$userId" },
        pageVisits: {
          $sum: { $cond: [{ $eq: ["$eventType", "page_visit"] }, 1, 0] },
        },
        actions: {
          $sum: { $cond: [{ $eq: ["$eventType", "action"] }, 1, 0] },
        },
      },
    },
    {
      $project: {
        _id: 0,
        totalEvents: 1,
        uniqueSessions: { $size: "$uniqueSessions" },
        uniqueUsers: { $size: "$uniqueUsers" },
        pageVisits: 1,
        actions: 1,
      },
    },
  ];

  const [result] = await UserJourneyEvent.aggregate(pipeline);
  return (
    result || {
      totalEvents: 0,
      uniqueSessions: 0,
      uniqueUsers: 0,
      pageVisits: 0,
      actions: 0,
    }
  );
};

export default {
  recordJourneyEvent,
  recordBulkJourneyEvents,
  getUserJourney,
  getFlowPatterns,
  getPageStats,
  getJourneySummary,
};