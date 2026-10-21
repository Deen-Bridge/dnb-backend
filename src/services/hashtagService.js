// services/hashtagService.js — Issue #212
import Hashtag from "../models/Hashtag.js";
import Reel from "../models/Reel.js";
import logger from "../config/logger.js";
import { extractHashtags } from "../utils/hashtagExtractor.js";

/**
 * Increment usage counts for a list of tag slugs.
 * Called whenever a new reel is published.
 *
 * @param {string[]} tags - Normalised slugs (no '#').
 */
export const incrementHashtagUsage = async (tags) => {
  if (!tags || tags.length === 0) return;

  const ops = tags.map((tag) => ({
    updateOne: {
      filter: { tag },
      update: { $inc: { usageCount: 1 } },
      upsert: true,
    },
  }));

  await Hashtag.bulkWrite(ops);
};

/**
 * Return the top N trending hashtags, ordered by trendingScore desc.
 *
 * @param {number} limit - Number of tags to return (default 20).
 */
export const getTrendingHashtags = async (limit = 20) => {
  return Hashtag.find({ trendingScore: { $gt: 0 } })
    .sort({ trendingScore: -1 })
    .limit(limit)
    .lean();
};

/**
 * Return all reels that contain a given hashtag slug.
 *
 * @param {string} tag   - Normalised slug (no '#').
 * @param {object} opts  - { page, limit }
 */
export const getReelsByHashtag = async (tag, { page = 1, limit = 20 } = {}) => {
  const normTag = tag.toLowerCase().replace(/^#/, "");
  const skip = (page - 1) * limit;

  const [reels, total] = await Promise.all([
    Reel.find({ tags: normTag, status: "active", isRemoved: false })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate("createdBy", "name avatar"),
    Reel.countDocuments({ tags: normTag, status: "active", isRemoved: false }),
  ]);

  return { reels, total, page, limit };
};

/**
 * Recalculate trending scores for all hashtags.
 * Called hourly by the trending-hashtags job.
 *
 * Score formula (simple time-decay):
 *   score = (usageCount_24h * 3) + (usageCount_7d * 1)
 *
 * The weights are deliberately simple — easily tuned later.
 */
export const recalculateTrendingScores = async () => {
  const now = new Date();
  const cutoff24h = new Date(now - 24 * 60 * 60 * 1000);
  const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000);

  // Aggregate recent reel counts per tag.
  const [counts24h, counts7d] = await Promise.all([
    Reel.aggregate([
      { $match: { createdAt: { $gte: cutoff24h }, status: "active", isRemoved: false } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
    ]),
    Reel.aggregate([
      { $match: { createdAt: { $gte: cutoff7d }, status: "active", isRemoved: false } },
      { $unwind: "$tags" },
      { $group: { _id: "$tags", count: { $sum: 1 } } },
    ]),
  ]);

  const map24h = Object.fromEntries(counts24h.map((r) => [r._id, r.count]));
  const map7d = Object.fromEntries(counts7d.map((r) => [r._id, r.count]));

  const allTags = new Set([...Object.keys(map24h), ...Object.keys(map7d)]);

  const ops = Array.from(allTags).map((tag) => {
    const c24 = map24h[tag] ?? 0;
    const c7d = map7d[tag] ?? 0;
    const score = c24 * 3 + c7d;
    return {
      updateOne: {
        filter: { tag },
        update: {
          $set: {
            trendingScore: score,
            recentUsage24h: c24,
            recentUsage7d: c7d,
            lastCalculatedAt: now,
          },
        },
        upsert: true,
      },
    };
  });

  if (ops.length > 0) {
    await Hashtag.bulkWrite(ops);
  }

  // Zero-out scores for tags with no recent activity.
  await Hashtag.updateMany(
    { tag: { $nin: Array.from(allTags) }, trendingScore: { $gt: 0 } },
    { $set: { trendingScore: 0, recentUsage24h: 0, recentUsage7d: 0, lastCalculatedAt: now } }
  );

  logger.info({ tagsUpdated: ops.length }, "Trending hashtag scores recalculated");
};
