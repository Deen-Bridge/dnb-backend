/**
 * @module src/middlewares/dateFormatter
 * Middleware to attach date formatting utilities and dual calendar metadata to requests and responses.
 */

import { Request, Response, NextFunction } from "express";
import { formatDualDate, gregorianToHijri, hijriToGregorian } from "../utils/hijriCalendar.ts";

export interface DateFormattedRequest extends Request {
  dateUtils?: {
    formatDual: typeof formatDualDate;
    toHijri: typeof gregorianToHijri;
    toGregorian: typeof hijriToGregorian;
  };
}

export const dateFormatterMiddleware = (
  req: DateFormattedRequest,
  res: Response,
  next: NextFunction
): void => {
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
