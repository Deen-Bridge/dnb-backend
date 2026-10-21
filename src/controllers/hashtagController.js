// controllers/hashtagController.js — Issue #212
import {
  getTrendingHashtags,
  getReelsByHashtag,
} from "../services/hashtagService.js";

/**
 * GET /api/hashtags/trending
 * Returns the top N trending hashtags ordered by score.
 * Query: limit (default 20, max 50)
 */
export const getTrending = async (req, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 50);
    const hashtags = await getTrendingHashtags(limit);
    res.json({ success: true, data: hashtags });
  } catch (err) {
    next(err);
  }
};

/**
 * GET /api/hashtags/:tag/reels
 * Returns all active reels tagged with :tag (paginated).
 * Query: page, limit
 */
export const getReelsByTag = async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const result = await getReelsByHashtag(req.params.tag, {
      page: Number(page),
      limit: Number(limit),
    });
    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
};
