import crypto from "crypto";
import { recordJourneyEvent } from "../../services/analytics/journey-tracking-service.js";
import logger from "../../config/logger.js";

/**
 * Generate a stable session ID from the request headers or create a new one.
 */
const getSessionId = (req) => {
  return (
    req.headers["x-session-id"] ||
    req.cookies?.sessionId ||
    crypto.randomUUID()
  );
};

/**
 * Hash an IP address for privacy-preserving storage.
 */
const hashIp = (ip) => {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
};

/** Paths that are infrastructure plumbing rather than frontend navigation. */
const SKIP_PAGE_VISIT = /^\/(metrics|health|ping)(\/|$)/;

/**
 * Middleware to capture page visits.
 *
 * Wired globally (see app.js) so every navigation is recorded with a
 * timestamp, session id, referrer, and page URL. Only GET/HEAD requests are
 * treated as page visits; actions captured by trackAction cover everything
 * else. Tracking is fire-and-forget so it never slows the request.
 */
export const trackPageVisit = (req, res, next) => {
  if (req.method !== "GET") return next();
  if (SKIP_PAGE_VISIT.test(req.path)) return next();

  const event = {
    userId: req.user?._id || null,
    sessionId: getSessionId(req),
    eventType: "page_visit",
    page: req.originalUrl || req.url,
    referrer: req.headers.referer || req.headers.referrer || null,
    userAgent: req.headers["user-agent"] || null,
    ipHash: hashIp(req.ip || req.connection?.remoteAddress),
    metadata: {
      method: req.method,
      query: req.query,
    },
  };

  recordJourneyEvent(event).catch((err) =>
    logger.error("Failed to track page visit:", err)
  );

  next();
};

/**
 * Middleware factory to track a specific named user action.
 *
 * Attach to a route you want to observe, e.g. `trackAction("enroll_course")`.
 * The action name becomes the stored `action` field on the journey event so
 * key engagement steps are distinguishable in flow analysis.
 */
export const trackAction = (actionName) => {
  return (req, res, next) => {
    const event = {
      userId: req.user?._id || null,
      sessionId: getSessionId(req),
      eventType: "action",
      page: req.originalUrl || req.url,
      action: actionName,
      referrer: req.headers.referer || req.headers.referrer || null,
      userAgent: req.headers["user-agent"] || null,
      ipHash: hashIp(req.ip || req.connection?.remoteAddress),
      metadata: {
        method: req.method,
        bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : [],
      },
    };

    recordJourneyEvent(event).catch((err) =>
      logger.error("Failed to track action:", err)
    );

    next();
  };
};

export default {
  trackPageVisit,
  trackAction,
};