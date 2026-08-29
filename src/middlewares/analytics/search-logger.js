import { logSearchEvent } from "../../services/analytics/search-analytics-service.js";
import logger from "../../config/logger.js";

/**
 * Sum the number of returned items across the possible search response
 * shapes. The search endpoints currently expose the payload either as
 * `body.data` (standardized envelope) or the legacy `body.results`, and the
 * payload itself may be a bare array (educators) or an object keyed by
 * collection (courses/books/spaces/reels).
 */
const countResults = (body) => {
  let payload = body?.data;
  if (payload === undefined && body != null) {
    payload = body.results;
  }
  if (payload === undefined) return 0;

  if (Array.isArray(payload)) return payload.length;

  if (payload && typeof payload === "object") {
    let total = 0;
    for (const items of Object.values(payload)) {
      if (Array.isArray(items)) total += items.length;
    }
    return total;
  }

  return 0;
};

/**
 * Middleware to log search queries for analytics.
 *
 * Wires into the real search routes and records one event per query with a
 * timestamp (via the model's `createdAt`), the result count, and whether the
 * search returned zero results — the signal used to spot dead ends in
 * content discovery. Logging is fire-and-forget: a failed write is logged
 * and never fails or slows the search response.
 */
export const searchLogger = (req, res, next) => {
  const originalJson = res.json.bind(res);

  res.json = function (body) {
    // Restore the original so we don't double-wrap on subsequent calls.
    res.json = originalJson;

    const query = (req.query.q || req.query.query || "").trim();
    if (query) {
      const resultCount = countResults(body);
      const event = {
        userId: req.user?._id || null,
        sessionId: req.headers["x-session-id"] || null,
        query,
        type: req.query.type || "all",
        resultCount,
        hasResults: resultCount > 0,
        filters: {
          category: req.query.category || null,
          minPrice: req.query.minPrice || null,
          maxPrice: req.query.maxPrice || null,
          free: req.query.free || null,
          minRating: req.query.minRating || null,
        },
        userAgent: req.headers["user-agent"] || null,
      };

      logSearchEvent(event).catch((err) =>
        logger.error("Failed to log search event:", err)
      );
    }

    return originalJson(body);
  };

  next();
};

export default searchLogger;