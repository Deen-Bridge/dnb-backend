import mongoose from "mongoose";
import Reel from "../models/Reel.js";
import cloudinary from "../../utils/cloudinary.js";

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
      }
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
    stats: {
      likes: likeSet.size,
      loves: loveSet.size,
      comments: reel.comments?.length || 0,
      shares: reel.shareCount || 0,
      views: reel.viewCount || 0,
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
      50
    );
    const skip = (page - 1) * limit;
    const viewerId = req.user?._id;

    const [reels, total] = await Promise.all([
      Reel.find()
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
    console.error("Error fetching reels:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getReelById = async (req, res) => {
  try {
    const { id } = req.params;
    const viewerId = req.user?._id;

    const reel = await Reel.findById(id)
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
    console.error("Error fetching reel:", error);
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
      uploadOptions
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
    console.error("Error creating reel:", error);
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

    const reel = await Reel.findById(id);
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const targetField = type === "like" ? "likes" : "loves";
    const oppositeField = type === "like" ? "loves" : "likes";
    const userKey = userId.toString();

    const alreadyReacted = reel[targetField].some(
      (entry) => entry.toString() === userKey
    );

    if (alreadyReacted) {
      reel[targetField] = reel[targetField].filter(
        (entry) => entry.toString() !== userKey
      );
    } else {
      reel[targetField].push(userId);
      reel[oppositeField] = reel[oppositeField].filter(
        (entry) => entry.toString() !== userKey
      );
    }

    await reel.save();

    res.status(200).json({
      success: true,
      reactions: {
        likes: reel.likes.length,
        loves: reel.loves.length,
      },
      viewerState: {
        liked: !alreadyReacted && type === "like",
        loved: !alreadyReacted && type === "love",
      },
    });
  } catch (error) {
    console.error("Error reacting to reel:", error);
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

    const reel = await Reel.findById(id);
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const commentId = new mongoose.Types.ObjectId();
    const comment = {
      _id: commentId,
      user: userId,
      text: text.trim(),
      createdAt: new Date(),
    };

    reel.comments.push(comment);
    await reel.save();

    const populatedComment = await Reel.findOne(
      { _id: reel._id, "comments._id": commentId },
      { "comments.$": 1 }
    )
      .populate("comments.user", "name avatar")
      .lean();

    res.status(201).json({
      success: true,
      comment: populatedComment?.comments?.[0],
      stats: { comments: reel.comments.length },
    });
  } catch (error) {
    console.error("Error adding reel comment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getReelComments = async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(
      Math.max(parseInt(req.query.limit, 10) || 20, 1),
      100
    );
    const skip = (page - 1) * limit;

    const reel = await Reel.findById(id)
      .select("comments")
      .populate("comments.user", "name avatar")
      .lean();

    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const sortedComments = [...(reel.comments || [])].sort(
      (a, b) => b.createdAt - a.createdAt
    );

    const paginated = sortedComments.slice(skip, skip + limit);
    const hasMore = skip + paginated.length < sortedComments.length;

    res.status(200).json({
      success: true,
      page,
      limit,
      total: sortedComments.length,
      hasMore,
      comments: paginated,
    });
  } catch (error) {
    console.error("Error fetching reel comments:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteReelComment = async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const userId = req.user?._id?.toString();

    const reel = await Reel.findById(id);
    if (!reel) {
      return res
        .status(404)
        .json({ success: false, message: "Reel not found" });
    }

    const comment = reel.comments.id(commentId);
    if (!comment) {
      return res
        .status(404)
        .json({ success: false, message: "Comment not found" });
    }

    const isOwner =
      comment.user.toString() === userId ||
      reel.createdBy.toString() === userId;

    if (!isOwner) {
      return res
        .status(403)
        .json({ success: false, message: "Not authorized to delete comment" });
    }

    comment.remove();
    await reel.save();

    res.status(200).json({
      success: true,
      message: "Comment deleted",
      stats: { comments: reel.comments.length },
    });
  } catch (error) {
    console.error("Error deleting reel comment:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerReelShare = async (req, res) => {
  try {
    const { id } = req.params;
    const reel = await Reel.findByIdAndUpdate(
      id,
      { $inc: { shareCount: 1 } },
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
    console.error("Error updating reel share count:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};

export const registerReelView = async (req, res) => {
  try {
    const { id } = req.params;
    const reel = await Reel.findByIdAndUpdate(
      id,
      { $inc: { viewCount: 1 } },
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
    console.error("Error updating reel view count:", error);
    res.status(500).json({ success: false, message: error.message });
  }
};
