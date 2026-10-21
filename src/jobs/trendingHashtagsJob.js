// jobs/trendingHashtagsJob.js — Issue #212
/**
 * Scheduled job: recalculate trending hashtag scores every hour.
 *
 * This file is imported by server.js (or a scheduler bootstrap) and
 * schedules itself using Node's setInterval. For production, replace with
 * a proper cron runner (node-cron, Agenda, BullMQ repeatable jobs, etc.).
 *
 * Interval: 60 minutes (configurable via TRENDING_HASHTAGS_INTERVAL_MS).
 */
import { recalculateTrendingScores } from "../services/hashtagService.js";
import logger from "../config/logger.js";

const INTERVAL_MS =
  Number(process.env.TRENDING_HASHTAGS_INTERVAL_MS) || 60 * 60 * 1000; // 1 hour

/**
 * Run the score recalculation once and log the outcome.
 */
const runTrendingJob = async () => {
  logger.info("Trending hashtag job: starting recalculation");
  try {
    await recalculateTrendingScores();
    logger.info("Trending hashtag job: completed successfully");
  } catch (err) {
    logger.error({ err }, "Trending hashtag job: failed");
  }
};

/**
 * Start the scheduled job.
 * Runs immediately on boot, then repeats every INTERVAL_MS.
 *
 * @returns {NodeJS.Timeout} Interval handle (call clearInterval to stop).
 */
export const startTrendingHashtagsJob = () => {
  // Run immediately on startup so scores are fresh.
  runTrendingJob();
  const handle = setInterval(runTrendingJob, INTERVAL_MS);
  logger.info(
    { intervalMs: INTERVAL_MS },
    "Trending hashtag job scheduled"
  );
  return handle;
};
