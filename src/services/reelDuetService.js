// services/reelDuetService.js
//
// Business logic for duet/stitch response videos. A derivative reel is a normal
// reel that additionally links back to an original reel via `originalReelId`
// and records its `duetType`. Creating one increments the derivative counter on
// the original so it can be surfaced on the original reel.

import mongoose from "mongoose";
import Reel from "../models/Reel.js";
import { publicReelFilter } from "../utils/reelVisibility.js";
import {
  isDuetType,
  buildCompositionDescriptor,
  normalizeStitchClip,
} from "../utils/videoCompositor.js";

const httpError = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode });

/**
 * Create a duet/stitch response reel linked to an original reel.
 *
 * @param {Object} params
 * @param {string} params.originalReelId
 * @param {"duet"|"stitch"} params.type
 * @param {string} params.userId          - author of the response
 * @param {string} params.description
 * @param {string} [params.category]
 * @param {string[]} [params.tags]
 * @param {string} params.video           - uploaded response video URL
 * @param {string} [params.videoPublicId]
 * @param {string} [params.thumbnail]
 * @param {number} [params.duration]
 * @param {Object} [params.clip]          - stitch clip range ({ start, end })
 * @returns {Promise<import("mongoose").Document>} the created derivative reel
 */
export const createReelDerivative = async ({
  originalReelId,
  type,
  userId,
  description,
  category,
  tags,
  video,
  videoPublicId,
  thumbnail,
  duration,
  clip,
}) => {
  if (!isDuetType(type)) {
    throw httpError("type must be one of: duet, stitch", 400);
  }
  if (!mongoose.Types.ObjectId.isValid(originalReelId)) {
    throw httpError("A valid original reel id is required", 400);
  }

  // Derivatives inherit moderation visibility. The state predicate is part of
  // the read so removed or pending originals cannot be reused.
  const original = await Reel.findOne({
    _id: originalReelId,
    ...publicReelFilter(),
    status: "active",
    isRemoved: { $ne: true },
  }).select("_id video duration status isRemoved");
  if (!original) {
    throw httpError("Original reel not found", 404);
  }

  const stitchClip = type === "stitch" ? normalizeStitchClip(clip) : null;
  if (type === "stitch" && !stitchClip) {
    throw httpError(
      "A stitch requires a valid clip range ({ start, end } in seconds, end > start)",
      400,
    );
  }

  const composition = buildCompositionDescriptor({
    type,
    original,
    response: { video, duration },
    clip: stitchClip,
  });

  const derivative = await Reel.create({
    description,
    category,
    tags: Array.isArray(tags) ? tags : [],
    video,
    videoPublicId,
    thumbnail,
    duration,
    createdBy: userId,
    originalReelId: original._id,
    duetType: type,
    stitchClip: stitchClip || undefined,
    composition,
  });

  // Increment the derivative counter surfaced on the original reel.
  const counterField = type === "duet" ? "duetCount" : "stitchCount";
  const counterUpdate = await Reel.updateOne(
    { _id: original._id, status: "active", isRemoved: { $ne: true } },
    { $inc: { [counterField]: 1 } },
  );
  if (counterUpdate.matchedCount !== 1) {
    // Moderation won the race after the initial read. Remove the derivative so
    // the original cannot retain a visible child or an inflated counter.
    await Reel.deleteOne({ _id: derivative._id });
    throw httpError("Original reel is no longer available", 409);
  }

  return derivative;
};

/**
 * List duet/stitch derivatives for a given reel, paginated (newest first).
 *
 * @param {string} originalReelId
 * @param {Object} [options]
 * @param {number} [options.page=1]
 * @param {number} [options.limit=10]
 * @param {"duet"|"stitch"} [options.type]  - optional filter
 * @returns {Promise<{items: Object[], page: number, limit: number, total: number, hasMore: boolean}>}
 */
export const listReelDerivatives = async (
  originalReelId,
  { page = 1, limit = 10, type } = {},
) => {
  const safePage = Math.max(parseInt(page, 10) || 1, 1);
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const skip = (safePage - 1) * safeLimit;

  const filter = {
    originalReelId,
    ...publicReelFilter(),
    status: "active",
    isRemoved: { $ne: true },
  };
  if (isDuetType(type)) {
    filter.duetType = type;
  }

  const [items, total] = await Promise.all([
    Reel.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(safeLimit)
      .populate("createdBy", "name avatar")
      .lean(),
    Reel.countDocuments(filter),
  ]);

  return {
    items,
    page: safePage,
    limit: safeLimit,
    total,
    hasMore: skip + items.length < total,
  };
};

export default {
  createReelDerivative,
  listReelDerivatives,
};
