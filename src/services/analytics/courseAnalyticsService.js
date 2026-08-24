// services/analytics/courseAnalyticsService.js
//
// Data-access + orchestration layer for creator course analytics. Pulls the
// raw signals from the existing collections (Course, CourseProgress,
// Transaction, User.purchasedCourses) and hands them to the pure calculators
// in utils/analyticsCalculator.js to produce the metrics returned by the
// creator analytics endpoints.
//
// Nothing here mutates state — these are read-only aggregations.

import mongoose from "mongoose";
import Course from "../../models/Course.js";
import CourseProgress from "../../models/CourseProgress.js";
import Transaction from "../../models/Transaction.js";
import User from "../../models/User.js";
import {
  computeCompletionRate,
  computeConversionRate,
  computeEngagement,
  computeDropOff,
  sumRevenue,
} from "../../utils/analyticsCalculator.js";

/**
 * Normalise a raw date-range input into concrete Date objects.
 *
 * @param {string|Date} [startDate] - Inclusive lower bound (ISO string or Date).
 * @param {string|Date} [endDate]   - Inclusive upper bound (ISO string or Date).
 * @returns {{start: Date|null, end: Date|null}} Parsed bounds (null when absent/invalid).
 */
export const parseDateRange = (startDate, endDate) => {
  const toDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  return { start: toDate(startDate), end: toDate(endDate) };
};

/**
 * Build a Mongo range filter fragment for a timestamp field.
 *
 * @param {Date|null} start - Inclusive lower bound.
 * @param {Date|null} end   - Inclusive upper bound.
 * @returns {object} A `{ $gte, $lte }` object, or `{}` when both bounds are null.
 */
const rangeFilter = (start, end) => {
  const filter = {};
  if (start) filter.$gte = start;
  if (end) filter.$lte = end;
  return filter;
};

/**
 * Flatten a course's ordered sections/lessons into a single ordered lesson list.
 *
 * @param {object} course - A Course document (lean or hydrated).
 * @returns {Array<{lessonId: string, title: string}>} Ordered lessons.
 */
export const flattenLessons = (course) => {
  const sections = [...(course.sections || [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
  );
  const lessons = [];
  for (const section of sections) {
    const ordered = [...(section.lessons || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0)
    );
    for (const lesson of ordered) {
      if (!lesson?._id) continue;
      lessons.push({
        lessonId: String(lesson._id),
        title: lesson.title || section.title || "Lesson",
      });
    }
  }
  return lessons;
};

/**
 * Count enrollments for a course within an optional date range, using the
 * per-user `purchasedCourses.purchaseDate` (covers both free enrollments and
 * paid purchases, each of which records a purchaseDate).
 *
 * @param {mongoose.Types.ObjectId} courseId - Course id.
 * @param {Date|null} start - Inclusive lower bound.
 * @param {Date|null} end   - Inclusive upper bound.
 * @returns {Promise<number>} Enrollment count in the window.
 */
const countEnrollmentsInRange = async (courseId, start, end) => {
  const range = rangeFilter(start, end);
  const hasRange = Object.keys(range).length > 0;

  const match = { "purchasedCourses.courseId": courseId };
  const unwoundMatch = { "purchasedCourses.courseId": courseId };
  if (hasRange) unwoundMatch["purchasedCourses.purchaseDate"] = range;

  const result = await User.aggregate([
    { $match: match },
    { $unwind: "$purchasedCourses" },
    { $match: unwoundMatch },
    { $count: "count" },
  ]);

  return result[0]?.count || 0;
};

/**
 * Compute the full analytics payload for a single course.
 *
 * @param {string|mongoose.Types.ObjectId} courseId - Course id.
 * @param {object} [options]
 * @param {string|Date} [options.startDate] - Inclusive range start.
 * @param {string|Date} [options.endDate]   - Inclusive range end.
 * @param {object} [options.courseDoc] - Pre-loaded Course doc to avoid a re-fetch
 *   (e.g. `req.resource` from the ownership middleware).
 * @returns {Promise<object|null>} Analytics object, or null when the course is missing.
 */
export const getCourseAnalytics = async (courseId, options = {}) => {
  const { startDate, endDate, courseDoc } = options;
  const objectId = new mongoose.Types.ObjectId(courseId);
  const { start, end } = parseDateRange(startDate, endDate);

  const course =
    courseDoc || (await Course.findById(objectId).lean());
  if (!course) return null;

  const completionRange = rangeFilter(start, end);
  const hasRange = Object.keys(completionRange).length > 0;

  // Completions in-range: progress docs with a completedAt inside the window.
  const completionFilter = { course: objectId, completedAt: { $ne: null } };
  if (hasRange) completionFilter.completedAt = { ...completionRange, $ne: null };

  const revenueFilter = {
    creator: course.createdBy,
    itemType: "course",
    itemId: objectId,
    status: "confirmed",
  };
  if (hasRange) revenueFilter.createdAt = completionRange;

  const [progressDocs, completions, enrollmentsInRange, transactions] =
    await Promise.all([
      CourseProgress.find({ course: objectId }).lean(),
      CourseProgress.countDocuments(completionFilter),
      countEnrollmentsInRange(objectId, start, end),
      Transaction.find(revenueFilter).select("amount currency createdAt").lean(),
    ]);

  const enrollmentsTotal = Array.isArray(course.enrolledUsers)
    ? course.enrolledUsers.length
    : 0;
  const enrollments = hasRange ? enrollmentsInRange : enrollmentsTotal;

  const lessons = flattenLessons(course);
  const engagement = computeEngagement(progressDocs, start);
  const dropOff = computeDropOff(lessons, progressDocs);
  const revenue = sumRevenue(transactions);

  return {
    courseId: String(course._id),
    title: course.title,
    createdBy: String(course.createdBy),
    range: {
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
    },
    metrics: {
      views: course.views || 0,
      enrollments,
      enrollmentsTotal,
      completions,
      completionRate: computeCompletionRate(completions, enrollments),
      conversionRate: computeConversionRate(enrollments, course.views || 0),
      revenue,
      engagement,
      dropOff,
      totalLessons: lessons.length,
    },
  };
};

/**
 * Aggregate a lightweight analytics overview across every course owned by a
 * creator, plus a portfolio-level roll-up.
 *
 * @param {string|mongoose.Types.ObjectId} creatorId - The creator's user id.
 * @param {object} [options]
 * @param {string|Date} [options.startDate] - Inclusive range start.
 * @param {string|Date} [options.endDate]   - Inclusive range end.
 * @returns {Promise<{creatorId: string, range: object, totals: object, courses: object[]}>}
 */
export const getCreatorOverview = async (creatorId, options = {}) => {
  const { startDate, endDate } = options;
  const objectId = new mongoose.Types.ObjectId(creatorId);
  const { start, end } = parseDateRange(startDate, endDate);

  const courses = await Course.find({ createdBy: objectId }).lean();

  const perCourse = await Promise.all(
    courses.map((courseDoc) =>
      getCourseAnalytics(courseDoc._id, {
        startDate,
        endDate,
        courseDoc,
      })
    )
  );

  const totals = {
    courses: courses.length,
    views: 0,
    enrollments: 0,
    completions: 0,
    revenueByCurrency: {},
  };

  const summaries = [];
  for (const analytics of perCourse) {
    if (!analytics) continue;
    const m = analytics.metrics;
    totals.views += m.views;
    totals.enrollments += m.enrollments;
    totals.completions += m.completions;
    for (const [currency, amount] of Object.entries(
      m.revenue.revenueByCurrency
    )) {
      totals.revenueByCurrency[currency] =
        (totals.revenueByCurrency[currency] || 0) + amount;
    }
    summaries.push({
      courseId: analytics.courseId,
      title: analytics.title,
      views: m.views,
      enrollments: m.enrollments,
      completions: m.completions,
      completionRate: m.completionRate,
      conversionRate: m.conversionRate,
      revenue: m.revenue.grossByCurrency,
    });
  }

  totals.completionRate = computeCompletionRate(
    totals.completions,
    totals.enrollments
  );
  totals.conversionRate = computeConversionRate(
    totals.enrollments,
    totals.views
  );

  return {
    creatorId: String(objectId),
    range: {
      startDate: start ? start.toISOString() : null,
      endDate: end ? end.toISOString() : null,
    },
    totals,
    courses: summaries,
  };
};

export default {
  parseDateRange,
  flattenLessons,
  getCourseAnalytics,
  getCreatorOverview,
};
