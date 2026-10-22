// utils/analyticsCalculator.js
//
// Pure, side-effect-free helpers for turning raw course data (enrollment
// counts, progress documents, confirmed transactions, lesson lists) into the
// derived metrics surfaced by the creator analytics endpoints: completion and
// conversion rates, revenue roll-ups, engagement averages, per-lesson
// drop-off, and CSV serialisation.
//
// Keeping the math here (no DB access) makes each rule independently testable
// and lets the service layer stay focused on queries.

/**
 * Round a number to a fixed number of decimal places, guarding against NaN.
 *
 * @param {number} value    - Raw value to round.
 * @param {number} [places] - Decimal places to keep (default 2).
 * @returns {number} The rounded value, or 0 when the input is not finite.
 */
export const round = (value, places = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Completion rate as a percentage of enrolled learners who finished a course.
 *
 * @param {number} completions - Number of learners who completed the course.
 * @param {number} enrollments - Total number of enrolled learners.
 * @returns {number} Percentage in the range 0–100 (0 when there are no enrollments).
 */
export const computeCompletionRate = (completions, enrollments) => {
  if (!enrollments || enrollments <= 0) return 0;
  return round((completions / enrollments) * 100);
};

/**
 * Conversion rate as a percentage of course viewers who enrolled.
 *
 * @param {number} enrollments - Number of enrollments in the window.
 * @param {number} views       - Number of course views (cumulative).
 * @returns {number} Percentage in the range 0–100 (0 when there are no views).
 */
export const computeConversionRate = (enrollments, views) => {
  if (!views || views <= 0) return 0;
  return round((enrollments / views) * 100);
};

/**
 * Sum confirmed transaction amounts into a per-currency revenue roll-up.
 *
 * Transaction amounts are stored as precision-preserving strings and may span
 * multiple currencies, so revenue is grouped by currency rather than summed
 * into a single (meaningless) cross-currency total.
 *
 * @param {Array<{amount: string|number, currency?: string}>} transactions
 *   Confirmed transactions for the course/creator in the window.
 * @returns {{revenueByCurrency: Object<string, number>, transactionCount: number, grossByCurrency: Array<{currency: string, amount: number}>}}
 *   `revenueByCurrency` maps currency code -> total; `grossByCurrency` is the
 *   same data as a sorted array for easy CSV/row rendering.
 */
export const sumRevenue = (transactions = []) => {
  const revenueByCurrency = {};

  for (const tx of transactions) {
    const amount = parseFloat(tx?.amount);
    if (!Number.isFinite(amount)) continue;
    const currency = tx?.currency || "USDC";
    revenueByCurrency[currency] = round((revenueByCurrency[currency] || 0) + amount, 7);
  }

  const grossByCurrency = Object.entries(revenueByCurrency)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => a.currency.localeCompare(b.currency));

  return {
    revenueByCurrency,
    grossByCurrency,
    transactionCount: transactions.length,
  };
};

/**
 * Compute engagement averages across a set of progress documents.
 *
 * @param {Array<{percentComplete?: number, lessonsCompleted?: Array}>} progressDocs
 *   Progress records for learners of the course.
 * @param {Date|null} [activeSince] - When provided, learners whose progress was
 *   updated on/after this date are counted as "active".
 * @returns {{learnersStarted: number, avgPercentComplete: number, avgLessonsCompleted: number, activeLearners: number}}
 */
export const computeEngagement = (progressDocs = [], activeSince = null) => {
  const learnersStarted = progressDocs.length;
  if (!learnersStarted) {
    return {
      learnersStarted: 0,
      avgPercentComplete: 0,
      avgLessonsCompleted: 0,
      activeLearners: 0,
    };
  }

  let percentSum = 0;
  let lessonsSum = 0;
  let activeLearners = 0;

  for (const progress of progressDocs) {
    percentSum += Number(progress?.percentComplete || 0);
    lessonsSum += Array.isArray(progress?.lessonsCompleted)
      ? progress.lessonsCompleted.length
      : 0;
    if (activeSince && progress?.updatedAt && new Date(progress.updatedAt) >= activeSince) {
      activeLearners += 1;
    }
  }

  return {
    learnersStarted,
    avgPercentComplete: round(percentSum / learnersStarted),
    avgLessonsCompleted: round(lessonsSum / learnersStarted),
    activeLearners: activeSince ? activeLearners : learnersStarted,
  };
};

/**
 * Compute per-lesson reach and drop-off across ordered lessons.
 *
 * For each lesson (in course order) we count how many learners have completed
 * it (`reached`). The drop-off at a lesson is the number of learners who
 * reached the previous lesson but not this one — i.e. where they fell out of
 * the funnel. The lesson with the largest drop is flagged as the biggest
 * drop-off point.
 *
 * @param {Array<{lessonId: string, title?: string}>} lessons - Ordered lessons.
 * @param {Array<{lessonsCompleted?: Array}>} progressDocs - Learner progress.
 * @returns {{lessons: Array<{order: number, lessonId: string, title: string, reached: number, dropOff: number, dropOffRate: number}>, biggestDropOff: object|null}}
 */
export const computeDropOff = (lessons = [], progressDocs = []) => {
  const completedSets = progressDocs.map(
    (p) => new Set((p?.lessonsCompleted || []).map((id) => String(id)))
  );

  const rows = lessons.map((lesson, index) => {
    const lessonId = String(lesson.lessonId);
    const reached = completedSets.reduce(
      (count, set) => (set.has(lessonId) ? count + 1 : count),
      0
    );
    return {
      order: index + 1,
      lessonId,
      title: lesson.title || `Lesson ${index + 1}`,
      reached,
      dropOff: 0,
      dropOffRate: 0,
    };
  });

  // Drop-off is measured against the previous lesson's reach (the first lesson
  // is the funnel entry point, so it has no upstream drop).
  for (let i = 0; i < rows.length; i += 1) {
    const prevReached = i === 0 ? rows[0].reached : rows[i - 1].reached;
    const drop = Math.max(0, prevReached - rows[i].reached);
    rows[i].dropOff = i === 0 ? 0 : drop;
    rows[i].dropOffRate =
      i === 0 || prevReached <= 0 ? 0 : round((drop / prevReached) * 100);
  }

  const biggestDropOff = rows
    .filter((row) => row.order > 1)
    .reduce((max, row) => (!max || row.dropOff > max.dropOff ? row : max), null);

  return { lessons: rows, biggestDropOff };
};

/**
 * Escape a single value for inclusion in a CSV cell (RFC 4180 style): wrap in
 * double quotes and double any embedded quotes when the value contains a
 * comma, quote, or newline.
 *
 * @param {*} value - The raw cell value.
 * @returns {string} A CSV-safe cell string.
 */
export const escapeCsvCell = (value) => {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
};

/**
 * Build a CSV string from a header row and an array of row arrays.
 *
 * @param {string[]} headers - Column headers.
 * @param {Array<Array<*>>} rows - Row values (each inner array is one row).
 * @returns {string} A CSV document terminated with a trailing newline.
 */
export const buildCsv = (headers, rows) => {
  const lines = [headers.map(escapeCsvCell).join(",")];
  for (const row of rows) {
    lines.push(row.map(escapeCsvCell).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
};

/**
 * Flatten a computed analytics object into a two-column (metric,value) CSV
 * suitable for spreadsheet download. Per-currency revenue and per-lesson
 * drop-off are expanded into their own labelled rows.
 *
 * @param {object} analytics - The object returned by the analytics service.
 * @returns {string} CSV document.
 */
export const analyticsToCsv = (analytics = {}) => {
  const rows = [];
  const m = analytics.metrics || {};

  rows.push(["Course ID", analytics.courseId || ""]);
  rows.push(["Course Title", analytics.title || ""]);
  rows.push(["Range Start", analytics.range?.startDate || "all-time"]);
  rows.push(["Range End", analytics.range?.endDate || "all-time"]);
  rows.push(["Views (cumulative)", m.views ?? 0]);
  rows.push(["Enrollments (total)", m.enrollmentsTotal ?? 0]);
  rows.push(["Enrollments (in range)", m.enrollments ?? 0]);
  rows.push(["Completions", m.completions ?? 0]);
  rows.push(["Completion Rate (%)", m.completionRate ?? 0]);
  rows.push(["Conversion Rate (%)", m.conversionRate ?? 0]);
  rows.push(["Learners Started", m.engagement?.learnersStarted ?? 0]);
  rows.push(["Active Learners", m.engagement?.activeLearners ?? 0]);
  rows.push(["Avg Percent Complete (%)", m.engagement?.avgPercentComplete ?? 0]);
  rows.push(["Avg Lessons Completed", m.engagement?.avgLessonsCompleted ?? 0]);
  rows.push(["Confirmed Transactions", m.revenue?.transactionCount ?? 0]);

  for (const entry of m.revenue?.grossByCurrency || []) {
    rows.push([`Revenue (${entry.currency})`, entry.amount]);
  }

  for (const lesson of m.dropOff?.lessons || []) {
    rows.push([
      `Lesson ${lesson.order} reached - ${lesson.title}`,
      lesson.reached,
    ]);
    rows.push([
      `Lesson ${lesson.order} drop-off (%) - ${lesson.title}`,
      lesson.dropOffRate,
    ]);
  }

  return buildCsv(["metric", "value"], rows);
};

export default {
  round,
  computeCompletionRate,
  computeConversionRate,
  sumRevenue,
  computeEngagement,
  computeDropOff,
  escapeCsvCell,
  buildCsv,
  analyticsToCsv,
};
