/**
 * @module src/middlewares/dateFormatter
 * Middleware to attach date formatting utilities and dual calendar metadata to requests and responses.
 */

import { formatDualDate, gregorianToHijri, hijriToGregorian } from "../utils/hijriCalendar.js";

export const dateFormatterMiddleware = (req, res, next) => {
  req.dateUtils = {
    formatDual: formatDualDate,
    toHijri: gregorianToHijri,
    toGregorian: hijriToGregorian,
  };

  // Also attach helper to response locals if needed
  res.locals.formatDualDate = formatDualDate;

  next();
};

export default dateFormatterMiddleware;
