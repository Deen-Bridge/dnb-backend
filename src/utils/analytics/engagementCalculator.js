// utils/analytics/engagementCalculator.js
//
// Pure, side-effect-free helpers that turn raw content signals (views,
// reviews, completion/progress records) into the engagement metrics surfaced
// by the content-performance analytics endpoints. Kept free of database access
// so each rule is independently testable.

/**
 * Round a number to a fixed number of decimal places, guarding against NaN.
 *
 * @param {number} value - Raw value to round.
 * @param {number} [places] - Decimal places to keep (default 2).
 * @returns {number} The rounded value, or 0 when the input is not finite.
 */
export const round = (value, places = 2) => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

/**
 * Interaction rate: the number of reviews/ratings per view, as a percentage.
 * Capped at 100 so a single review on a brand-new item cannot dominate.
 *
 * @param {number} interactions - Review count (numReviews).
 * @param {number} views - View/read count.
 * @returns {number} Percentage in the range 0-100.
 */
export const interactionRate = (interactions, views) => {
  if (!views || views <= 0 || !interactions || interactions <= 0) return 0;
  return Math.min(100, round((interactions / views) * 100));
};

/**
 * Completion rate: percentage of enrolled learners who finished the content.
 *
 * @param {number} completions - Learners who completed.
 * @param {number} enrollments - Learners who enrolled.
 * @returns {number} Percentage in the range 0-100.
 */
export const completionRate = (completions, enrollments) => {
  if (!enrollments || enrollments <= 0) return 0;
  return round((completions / enrollments) * 100);
};

/**
 * Average time spent (seconds) across a set of progress records — e.g. video
 * seconds watched (`lastPositionSeconds` on CourseProgress).
 *
 * @param {Array<{lastPositionSeconds?: number}>} progressDocs - Progress records.
 * @returns {number} Average seconds spent, rounded to 2 decimals.
 */
export const avgTimeSpentSeconds = (progressDocs = []) => {
  const started = progressDocs.filter(
    (p) => Number(p?.lastPositionSeconds || 0) > 0
  );
  if (!started.length) return 0;
  const total = started.reduce(
    (sum, p) => sum + Number(p.lastPositionSeconds || 0),
    0
  );
  return round(total / started.length);
};

/**
 * Average completion percentage across a set of progress records (0-100).
 *
 * @param {Array<{percentComplete?: number}>} progressDocs - Progress records.
 * @returns {number} Average percentage, rounded to 2 decimals.
 */
export const avgPercentComplete = (progressDocs = []) => {
  if (!progressDocs.length) return 0;
  const total = progressDocs.reduce(
    (sum, p) => sum + Number(p?.percentComplete || 0),
    0
  );
  return round(total / progressDocs.length);
};

/**
 * Composite engagement score in the range 0-100, blending how far learners got
 * (completion depth), how much the audience interacted (reviews per view) and
 * the average completion percentage of started learners.
 *
 * @param {object} metrics
 * @param {number} [metrics.completionRate] - Completion rate percentage (0-100).
 * @param {number} [metrics.interactionRate] - Interaction rate percentage (0-100).
 * @param {number} [metrics.avgPercentComplete] - Avg learner progress percentage.
 * @returns {number} Rounded score in the range 0-100.
 */
export const engagementScore = ({
  completionRate: cr = 0,
  interactionRate: ir = 0,
  avgPercentComplete: apc = 0,
} = {}) => {
  const score = 0.4 * cr + 0.3 * ir + 0.3 * apc;
  return Math.min(100, Math.max(0, round(score)));
};

export default {
  round,
  interactionRate,
  completionRate,
  avgTimeSpentSeconds,
  avgPercentComplete,
  engagementScore,
};
