// controllers/analytics/courseAnalyticsController.js
//
// Creator-facing HTTP handlers for course analytics. Ownership of a single
// course is enforced upstream by the authorizeOwnership middleware (which loads
// the course as req.resource); the overview handler is implicitly scoped to the
// authenticated creator. All handlers are read-only.

import mongoose from "mongoose";
import { catchAsync, APIError } from "../../middlewares/errorHandler.js";
import {
  getCourseAnalytics,
  getCreatorOverview,
} from "../../services/analytics/courseAnalyticsService.js";
import { analyticsToCsv } from "../../utils/analyticsCalculator.js";

/**
 * Extract and lightly validate the optional startDate/endDate query params.
 *
 * @param {import("express").Request} req
 * @returns {{startDate?: string, endDate?: string}}
 */
const readDateRange = (req) => {
  const { startDate, endDate } = req.query;
  return { startDate, endDate };
};

/**
 * GET /api/courses/analytics/:courseId
 *
 * Full analytics for a single course. Requires the caller to own the course
 * (enforced by authorizeOwnership, which attaches req.resource).
 */
export const getCourseAnalyticsHandler = catchAsync(async (req, res, next) => {
  const { courseId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return next(new APIError("Invalid course id", 400));
  }

  const analytics = await getCourseAnalytics(courseId, {
    ...readDateRange(req),
    courseDoc: req.resource, // provided by authorizeOwnership
  });

  if (!analytics) {
    return next(new APIError("Course not found", 404));
  }

  res.status(200).json({ success: true, analytics });
});

/**
 * GET /api/courses/analytics/:courseId/export?format=csv
 *
 * Export a single course's analytics. Defaults to CSV; `format=json` returns
 * the raw payload. (PDF is intentionally out of scope for this endpoint.)
 */
export const exportCourseAnalyticsHandler = catchAsync(async (req, res, next) => {
  const { courseId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(courseId)) {
    return next(new APIError("Invalid course id", 400));
  }

  const format = String(req.query.format || "csv").toLowerCase();

  const analytics = await getCourseAnalytics(courseId, {
    ...readDateRange(req),
    courseDoc: req.resource,
  });

  if (!analytics) {
    return next(new APIError("Course not found", 404));
  }

  if (format === "json") {
    return res.status(200).json({ success: true, analytics });
  }

  if (format !== "csv") {
    return next(
      new APIError("Unsupported export format. Use 'csv' or 'json'.", 400)
    );
  }

  const csv = analyticsToCsv(analytics);
  const filename = `course-${analytics.courseId}-analytics.csv`;

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.status(200).send(csv);
});

/**
 * GET /api/courses/analytics/overview
 *
 * Portfolio-level analytics across every course owned by the authenticated
 * creator, with an aggregate roll-up.
 */
export const getCreatorOverviewHandler = catchAsync(async (req, res) => {
  const overview = await getCreatorOverview(req.user._id, readDateRange(req));
  res.status(200).json({ success: true, overview });
});

export default {
  getCourseAnalyticsHandler,
  exportCourseAnalyticsHandler,
  getCreatorOverviewHandler,
};
