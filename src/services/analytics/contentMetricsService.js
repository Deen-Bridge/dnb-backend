// services/analytics/contentMetricsService.js
//
// Content performance analytics (issue #244): tracks view counts for courses
// and books, and aggregates engagement, completion and interaction metrics
// across all content so creators can see how their work is performing and
// compare items against each other.

import Course from "../../models/Course.js";
import Book from "../../models/Book.js";
import CourseProgress from "../../models/CourseProgress.js";
import ReadingProgress from "../../models/ReadingProgress.js";
import {
  interactionRate,
  completionRate,
  avgTimeSpentSeconds,
  avgPercentComplete,
  engagementScore,
} from "../../utils/analytics/engagementCalculator.js";

export class ContentMetricsService {
  /**
   * Record a course view (fire-and-forget so a failed metric write never
   * blocks or fails the detail response).
   *
   * @param {string} courseId - Course ObjectId.
   */
  async recordCourseView(courseId) {
    try {
      await Course.updateOne({ _id: courseId }, { $inc: { views: 1 } });
    } catch {
      // View tracking is best-effort; ignore write failures.
    }
  }

  /**
   * Record a book view (read) — same best-effort semantics as course views.
   *
   * @param {string} bookId - Book ObjectId.
   */
  async recordBookView(bookId) {
    try {
      await Book.updateOne({ _id: bookId }, { $inc: { readCount: 1 } });
    } catch {
      // View tracking is best-effort; ignore write failures.
    }
  }

  /**
   * Build the metrics row for a single course.
   *
   * @param {object} course - Lean Course document.
   * @param {Array<object>} progressDocs - CourseProgress records for the course.
   * @returns {object} The metrics row.
   */
  _courseRow(course, progressDocs) {
    const views = course.views || 0;
    const reviews = course.numReviews || 0;
    const enrollments = Array.isArray(course.enrolledUsers)
      ? course.enrolledUsers.length
      : 0;
    const completions = progressDocs.filter(
      (p) => p.completedAt || Number(p.percentComplete || 0) >= 100
    ).length;
    const cr = completionRate(completions, enrollments);

    return {
      id: String(course._id),
      type: "course",
      title: course.title,
      category: course.category || "",
      views,
      reviews,
      enrollments,
      completions,
      completionRate: cr,
      interactionRate: interactionRate(reviews, views),
      avgTimeSpentSeconds: avgTimeSpentSeconds(progressDocs),
      avgPercentComplete: avgPercentComplete(progressDocs),
      engagementScore: engagementScore({
        completionRate: cr,
        interactionRate: interactionRate(reviews, views),
        avgPercentComplete: avgPercentComplete(progressDocs),
      }),
    };
  }

  /**
   * Build the metrics row for a single book.
   *
   * @param {object} book - Lean Book document.
   * @param {Array<object>} progressDocs - ReadingProgress records for the book.
   * @returns {object} The metrics row.
   */
  _bookRow(book, progressDocs) {
    const views = book.readCount || 0;
    const reviews = book.numReviews || 0;
    // Books have no enrollments; learner depth is the average reading progress
    // (ReadingProgress stores the field as `percentage`, not `percentComplete`).
    const apc = avgPercentComplete(
      progressDocs.map((p) => ({ percentComplete: p.percentage }))
    );

    return {
      id: String(book._id),
      type: "book",
      title: book.title,
      category: book.category || "",
      views,
      reviews,
      enrollments: 0,
      completions: 0,
      completionRate: apc, // proxy: avg reading progress percentage
      interactionRate: interactionRate(reviews, views),
      avgTimeSpentSeconds: 0,
      avgPercentComplete: apc,
      engagementScore: engagementScore({
        completionRate: apc,
        interactionRate: interactionRate(reviews, views),
        avgPercentComplete: apc,
      }),
    };
  }

  /**
   * Comparative analytics across ALL content (courses + books), sorted by
   * views, with a platform-level roll-up.
   *
   * @returns {Promise<{summary: object, content: object[]}>}
   */
  async getContentPerformance() {
    const [courses, books] = await Promise.all([
      Course.find().lean(),
      Book.find().lean(),
    ]);

    const [courseProgress, bookProgress] = await Promise.all([
      CourseProgress.find({ course: { $in: courses.map((c) => c._id) } }).lean(),
      ReadingProgress.find({ book: { $in: books.map((b) => b._id) } }).lean(),
    ]);

    const progressByCourse = this._groupBy(courseProgress, "course");
    const progressByBook = this._groupBy(bookProgress, "book");

    const content = [
      ...courses.map((course) =>
        this._courseRow(course, progressByCourse.get(String(course._id)) || [])
      ),
      ...books.map((book) =>
        this._bookRow(book, progressByBook.get(String(book._id)) || [])
      ),
    ].sort((a, b) => b.views - a.views);

    // Course-only completion average for the roll-up (books have no enrollments).
    const courseRows = content.filter((row) => row.type === "course");
    const avgCourseCompletion = courseRows.length
      ? Math.round(
          (courseRows.reduce((sum, r) => sum + r.completionRate, 0) /
            courseRows.length) *
            100
        ) / 100
      : 0;

    return {
      summary: {
        totalContent: content.length,
        totalCourses: courseRows.length,
        totalBooks: content.length - courseRows.length,
        totalViews: content.reduce((sum, r) => sum + r.views, 0),
        totalReviews: content.reduce((sum, r) => sum + r.reviews, 0),
        avgCompletionRate: avgCourseCompletion,
        topByViews: [...content].sort((a, b) => b.views - a.views).slice(0, 3),
        topByEngagement: [...content]
          .sort((a, b) => b.engagementScore - a.engagementScore)
          .slice(0, 3),
      },
      content,
    };
  }

  /**
   * Metrics for a single course or book.
   *
   * @param {object} params
   * @param {"course"|"book"} params.type - Content type.
   * @param {string} params.id - Content ObjectId.
   * @returns {Promise<object|null>} The metrics row, or null when not found.
   */
  async getContentMetrics({ type, id }) {
    if (type === "course") {
      const course = await Course.findById(id).lean();
      if (!course) return null;
      const progressDocs = await CourseProgress.find({ course: id }).lean();
      return this._courseRow(course, progressDocs);
    }
    if (type === "book") {
      const book = await Book.findById(id).lean();
      if (!book) return null;
      const progressDocs = await ReadingProgress.find({ book: id }).lean();
      return this._bookRow(book, progressDocs);
    }
    return null;
  }

  /**
   * Group a list of documents by a field, keyed by its string value.
   *
   * @param {Array<object>} docs - Documents to group.
   * @param {string} field - Field name to group by.
   * @returns {Map<string, object[]>}
   */
  _groupBy(docs, field) {
    const groups = new Map();
    for (const doc of docs) {
      const key = String(doc[field]);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(doc);
    }
    return groups;
  }
}

export const contentMetricsService = new ContentMetricsService();
export default contentMetricsService;
