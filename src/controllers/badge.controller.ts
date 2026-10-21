import badgeService from "../services/badge.service.js";

export const getUserBadgesController = async (req, res) => {
  try {
    const userId = req.params.userId || req.user?._id;
    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "User ID is required",
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
