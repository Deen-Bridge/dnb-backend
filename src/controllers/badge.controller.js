import badgeService from "../services/badge.service.js";
import mongoose from "mongoose";
import User from "../models/User.js";

export const getUserBadgesController = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?._id;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
      });
    }

    // Badge records can reveal a user's participation and progress. Only the
    // owner or an admin may retrieve them until a deliberate share-token
    // contract exists.
    const isOwner = req.user?._id?.toString() === userId.toString();
    const isAdmin = req.user?.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(404).json({
        success: false,
        message: "User badges not found",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(404).json({
        success: false,
        message: "User badges not found",
      });
    }

    const userExists = await User.exists({ _id: userId });
    if (!userExists) {
      return res.status(404).json({
        success: false,
        message: "User badges not found",
      });
    }

    const userBadges = await badgeService.getUserBadges(userId);
    res.status(200).json({
      success: true,
      count: userBadges.length,
      data: userBadges,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const getAllBadgesController = async (req, res) => {
  try {
    const badges = await badgeService.getAllBadges();
    res.status(200).json({
      success: true,
      count: badges.length,
      data: badges,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const checkBadgesController = async (req, res) => {
  try {
    const newlyAwarded = await badgeService.checkAndAwardBadges(req.user._id);
    res.status(200).json({
      success: true,
      newlyAwardedCount: newlyAwarded.length,
      data: newlyAwarded,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
