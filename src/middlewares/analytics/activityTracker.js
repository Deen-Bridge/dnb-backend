// middlewares/analytics/activityTracker.js
//
// Records the authenticated user's activity on every request so real-time
// active-user counts reflect live usage. Mounted globally in app.js; it only
// does work when the request carries a valid Bearer token — the user id is
// decoded from the JWT (no database lookup) and the Redis write is
// fire-and-forget, so tracking can never slow down or break a request.

import jwt from "jsonwebtoken";
import logger from "../../config/logger.js";
import activeUsersService from "../../services/analytics/activeUsersService.js";

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

export const trackActivity = (req, res, next) => {
  const authorization = req.headers?.authorization || "";
  if (authorization.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(authorization.slice(7), JWT_SECRET);
      if (decoded?.userId) {
        activeUsersService
          .trackActivity({ userId: decoded.userId })
          .catch((err) => logger.warn("Activity tracking skipped:", err.message));
      }
    } catch {
      // Invalid/expired token — the route's own auth will reject the request;
      // there is nothing meaningful to track here.
    }
  }
  next();
};

export default trackActivity;
