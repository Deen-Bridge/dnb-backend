import { Request, Response } from "express";
import moderationService from "../services/moderation.service.ts";

export const flagReel = async (req: Request, res: Response) => {
  try {
    const { reelId } = req.params;
    const { reason, details } = req.body;
    const reporterId = (req as any).user._id;

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
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getModerationQueue = async (req: Request, res: Response) => {
  try {
    const status = req.query.status as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await moderationService.getModerationQueue({
      status,
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const processModerationAction = async (req: Request, res: Response) => {
  try {
    const { flagId } = req.params;
    const { reelId, action, notes } = req.body;
    const adminId = (req as any).user._id;

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
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getModerationHistory = async (req: Request, res: Response) => {
  try {
    const reelId = req.query.reelId as string;
    const adminId = req.query.adminId as string;
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    const result = await moderationService.getModerationHistory({
      reelId,
      adminId,
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  flagReel,
  getModerationQueue,
  processModerationAction,
  getModerationHistory,
};
