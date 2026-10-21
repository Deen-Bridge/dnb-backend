import moderationService from "../services/moderation.service.js";

export const flagReel = async (req, res) => {
  try {
    const { reelId } = req.params;
    const { reason, details } = req.body;
    const reporterId = req.user._id;

    if (!reason || reason.trim() === "") {
      return res.status(400).json({ success: false, message: "Reason for flagging is required" });
    }

    const flag = await moderationService.flagReel({
      reelId,
      reporterId,
      reason,
      details,
    });

    res.status(201).json({ success: true, flag, message: "Reel flagged for moderation" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getModerationQueue = async (req, res) => {
  try {
    const status = req.query.status;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await moderationService.getModerationQueue({
      status,
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const processModerationAction = async (req, res) => {
  try {
    const { flagId } = req.params;
    const { reelId, action, notes } = req.body;
    const adminId = req.user._id;

    if (!action || !["approve", "reject", "remove"].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Valid action ('approve', 'reject', 'remove') is required",
      });
    }

    const result = await moderationService.processModerationAction({
      flagId,
      reelId,
      adminId,
      action,
      notes,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getModerationHistory = async (req, res) => {
  try {
    const reelId = req.query.reelId;
    const adminId = req.query.adminId;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await moderationService.getModerationHistory({
      reelId,
      adminId,
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  flagReel,
  getModerationQueue,
  processModerationAction,
  getModerationHistory,
};
