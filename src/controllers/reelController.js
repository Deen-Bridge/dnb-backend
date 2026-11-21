import mongoose from "mongoose";
import Reel from "../models/Reel.js";
import ReelEngagement from "../models/ReelEngagement.js";
import ReelComment from "../models/ReelComment.js";
import cloudinary from "../utils/cloudinary.js";
import logger from "../config/logger.js";
import { publicReelFilter } from "../utils/reelVisibility.js";
import {
  createReelDerivative,
  listReelDerivatives,
} from "../services/reelDuetService.js";

const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      options,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      },
    );

    uploadStream.end(buffer);
  });

const normalizeTags = (rawTags) => {
  if (!rawTags) return [];
  if (Array.isArray(rawTags)) {
    return rawTags
      .map((tag) => (typeof tag === "string" ? tag.trim() : ""))
      .filter(Boolean);
  }
  return rawTags
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const formatReelResponse = (reel, viewerId) => {
  const likeSet = new Set((reel.likes || []).map(String));
  const loveSet = new Set((reel.loves || []).map(String));
  const viewerKey = viewerId ? viewerId.toString() : null;

  return {
    id: reel._id,
    description: reel.description,
    category: reel.category,
    tags: reel.tags || [],
    video: reel.video,
    videoPublicId: reel.videoPublicId,
    thumbnail: reel.thumbnail,
    duration: reel.duration,
    createdAt: reel.createdAt,
    updatedAt: reel.updatedAt,
    originalReelId: reel.originalReelId || null,
    duetType: reel.duetType || null,
    stitchClip: reel.stitchClip || null,
    composition: reel.composition || null,
    stats: {
      likes: likeSet.size,
      loves: loveSet.size,
      comments: reel.commentCount ?? reel.comments?.length ?? 0,
      shares: reel.shareCount || 0,
      views: reel.viewCount || 0,
      duets: reel.duetCount || 0,
      stitches: reel.stitchCount || 0,
    },
    viewerState: viewerKey
      ? {
          liked: likeSet.has(viewerKey),
          loved: loveSet.has(viewerKey),
        }
      : {
          liked: false,
          loved: false,
        },
    createdBy: reel.createdBy
      ? {
          id: reel.createdBy._id,
          name: reel.createdBy.name,
          avatar: reel.createdBy.avatar,
        }
      : null,
  };
};

export const getReels = async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 10, 1),
      50,
    );
    const skip = (page - 1) * limit;
    const viewerId = req.user?._id;

    const [reels, total] = await Promise.all([
      Reel.find(publicReelFilter())
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("createdBy", "name avatar")
        .lean(),
      Reel.countDocuments(),
    ]);

    const formatted = reels.map((reel) => formatReelResponse(reel, viewerId));
    const hasMore = skip + reels.length < total;

    res.status(200).json({
      success: true,
      page,
      limit,
      total,
      hasMore,
      reels: formatted,
    });
  } catch (error) {
    logger.error("Error fetching reels:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getReelById = async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = req.user?._id;

    const reel = await Reel.findOne({ _id: id, ...publicReelFilter() })
      .populate("createdBy", "name avatar")
      .lean();

    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    res
      .status(200)
      .json({ success: true, reel: formatReelResponse(reel, viewerId) });
  } catch (error) {
    logger.error("Error fetching reel:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createReel = async (req, res) => {
  try {
    const { description, category, tags } = req.body;
    const userId = req.user?._id;

    if (!description) {
      return res
        .status(400)
        .json({ success: false, message: "Description is required" });
    }

    if (!req.file?.buffer) {
      return res
        .status(400)
        .json({ success: false, message: "Video file is required" });
    }

    const uploadOptions = {
      resource_type: "video",
      folder: "dnb/reels",
    };

    const uploadResult = await uploadBufferToCloudinary(
      req.file.buffer,
      uploadOptions,
    );

    const reel = await Reel.create({
      description,
      category,
      tags: normalizeTags(tags),
      video: uploadResult.secure_url,
      videoPublicId: uploadResult.public_id,
      thumbnail: uploadResult.thumbnail_url || uploadResult.secure_url,
      duration: uploadResult.duration,
      createdBy: userId,
    });

    const populatedReel = await reel.populate("createdBy", "name avatar");

    res.status(201).json({
      success: true,
      reel: formatReelResponse(populatedReel.toObject(), userId),
    });
  } catch (error) {
    logger.error("Error creating reel:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const reactToReel = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.body;
    const userId = req.user?._id;

    if (!["like", "love"].includes(type)) {
      return res.status(400).json({
        success: false,
        message: "Reaction type must be either 'like' or 'love'",
      });
    }

    const userObjectId = new mongoose.Types.ObjectId(userId);
    const targetField = type === "like" ? "likes" : "loves";
    const oppositeField = type === "like" ? "loves" : "likes";
    const userKey = userObjectId.toString();

    // An aggregation update evaluates the toggle against the document being
    // updated. Unlike loading and saving the whole reel, this is atomic under
    // concurrent requests and cannot create duplicate array entries.
    const removeFrom = (field) => ({
      $filter: {
        input: { $ifNull: [`$${field}`, []] },
        as: "entry",
        cond: { $ne: [{ $toString: "$$entry" }, userKey] },
      },
    });
    const addToOrRemoveFrom = (field) => ({
      $cond: [
        {
          $in: [
            userObjectId,
            { $ifNull: [`$${field}`, []] },
          ],
        },
        removeFrom(field),
        { $setUnion: [{ $ifNull: [`$${field}`, []] }, [userObjectId]] },
      ],
    });

    const reel = await Reel.findOneAndUpdate(
      { _id: id, ...publicReelFilter() },
      [
        {
          $set: {
            [targetField]: addToOrRemoveFrom(targetField),
            [oppositeField]: removeFrom(oppositeField),
          },
        },
      ],
      { new: true }
    ).lean();
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const liked = (reel.likes || []).some((entry) => entry.toString() === userKey);
    const loved = (reel.loves || []).some((entry) => entry.toString() === userKey);

    res.status(200).json({
      success: true,
      reactions: {
        likes: (reel.likes || []).length,
        loves: (reel.loves || []).length,
      },
      viewerState: {
        liked,
        loved,
      },
    });
  } catch (error) {
    logger.error("Error reacting to reel:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const addReelComment = async (req, res) => {
  try {
    const { id } = req.params;
    const { text } = req.body;
    const userId = req.user?._id;

    if (!text || !text.trim()) {
      return res
        .status(400)
        .json({ success: false, message: "Comment text is required" });
    }

    const reel = await Reel.findOne({ _id: id, ...publicReelFilter() });
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const comment = await ReelComment.create({
      reel: reel._id,
      user: userId,
      text: text.trim(),
    });
    await Reel.updateOne({ _id: reel._id }, { $inc: { commentCount: 1 } });
    const populatedComment = await ReelComment.findById(comment._id)
      .populate("user", "name avatar")
      .lean();
    const commentCount = await ReelComment.countDocuments({
      reel: reel._id,
      status: "active",
    });

    res.status(201).json({
      success: true,
      comment: populatedComment,
      stats: { comments: commentCount },
    });
  } catch (error) {
    logger.error("Error adding reel comment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getReelComments = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      100,
    );
    const skip = (page - 1) * limit;

    const reel = await Reel.findOne({ _id: id, ...publicReelFilter() })
      .select("_id")
      .lean();

    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const query = { reel: id, status: "active" };
    const [paginated, total] = await Promise.all([
      ReelComment.find(query)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate("user", "name avatar")
        .lean(),
      ReelComment.countDocuments(query),
    ]);
    const hasMore = skip + paginated.length < total;

    res.status(200).json({
      success: true,
      page,
      limit,
      total,
      hasMore,
      comments: paginated,
    });
  } catch (error) {
    logger.error("Error fetching reel comments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteReelComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.user?._id?.toString();

    const reel = await Reel.findOne({ _id: id, ...publicReelFilter() });
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const isReelOwner = reel.createdBy.toString() === userId;
    const comment = await ReelComment.findOne({
      _id: commentId,
      reel: id,
      status: "active",
    });
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    if (!isReelOwner && comment.user.toString() !== userId) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to delete comment" });
    }

    await ReelComment.updateOne(
      { _id: commentId, reel: id, status: "active" },
      { $set: { status: "removed", deletedAt: new Date() } },
    );

    await Reel.updateOne(
      { _id: id, commentCount: { $gt: 0 } },
      { $inc: { commentCount: -1 } },
    );
    const commentCount = await ReelComment.countDocuments({
      reel: id,
      status: "active",
    });

    res.status(200).json({
      success: true,
      message: "Comment deleted",
      stats: { comments: commentCount },
    });
  } catch (error) {
    logger.error("Error deleting reel comment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerReelShare = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    let counted = false;
    try {
      await ReelEngagement.create({ reel: id, user: userId, kind: "share" });
      counted = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    const reel = await Reel.findOneAndUpdate(
      { _id: id, ...publicReelFilter() },
      counted ? { $inc: { shareCount: 1 } } : { $set: {} },
      { new: true }
    ).lean();

    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    res.status(200).json({
      success: true,
      shareCount: reel.shareCount,
    });
  } catch (error) {
    logger.error("Error updating reel share count:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerReelView = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;
    let counted = false;
    try {
      await ReelEngagement.create({ reel: id, user: userId, kind: "view" });
      counted = true;
    } catch (error) {
      if (error?.code !== 11000) throw error;
    }
    const reel = await Reel.findOneAndUpdate(
      { _id: id, ...publicReelFilter() },
      counted ? { $inc: { viewCount: 1 } } : { $set: {} },
      { new: true }
    ).lean();

    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    res.status(200).json({
      success: true,
      viewCount: reel.viewCount,
    });
  } catch (error) {
    logger.error("Error updating reel view count:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// ======================
// DUET / STITCH
// ======================

// Create a duet/stitch response video linked to the original reel (:id).
// A `duet` is displayed side-by-side with the original; a `stitch` prepends a
// clip of the original before the response plays.
export const createReelDuet = async (req, res) => {
  try {
    const { id } = req.params;
    const { description, category, tags, type, stitchStart, stitchEnd } =
      req.body;
    const userId = req.user?._id;

    if (!req.file?.buffer) {
      return res
        .status(400)
        .json({ success: false, message: "Video file is required" });
    }

    const uploadResult = await uploadBufferToCloudinary(req.file.buffer, {
      resource_type: "video",
      folder: "dnb/reels/duets",
    });

    const clip =
      type === "stitch"
        ? { start: Number(stitchStart), end: Number(stitchEnd) }
        : undefined;

    const derivative = await createReelDerivative({
      originalReelId: id,
      type,
      userId,
      description,
      category,
      tags: normalizeTags(tags),
      video: uploadResult.secure_url,
      videoPublicId: uploadResult.public_id,
      thumbnail: uploadResult.thumbnail_url || uploadResult.secure_url,
      duration: uploadResult.duration,
      clip,
    });

    const populatedReel = await derivative.populate("createdBy", "name avatar");

    res.status(201).json({
      success: true,
      reel: formatReelResponse(populatedReel.toObject(), userId),
    });
  } catch (error) {
    logger.error("Error creating reel duet/stitch:", error);
    res
      .status(error.statusCode || 500)
      .json({ success: false, message: error.message });
  }
};

// Browse all duets/stitches for a given reel (:id). Optional ?type=duet|stitch.
export const getReelDerivatives = async (req, res) => {
  try {
    const { id } = req.params;
    const { type } = req.query;
    const viewerId = req.user?._id;

    const original = await Reel.findOne({
      _id: id,
      ...publicReelFilter(),
    }).select("_id duetCount stitchCount");
    if (!original) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const { items, page, limit, total, hasMore } = await listReelDerivatives(
      id,
      { page: req.query.page, limit: req.query.limit, type },
    );

    res.status(200).json({
      success: true,
      page,
      limit,
      total,
      hasMore,
      counts: {
        duets: original.duetCount || 0,
        stitches: original.stitchCount || 0,
      },
      reels: items.map((reel) => formatReelResponse(reel, viewerId)),
    });
  } catch (error) {
    logger.error("Error fetching reel duets/stitches:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
