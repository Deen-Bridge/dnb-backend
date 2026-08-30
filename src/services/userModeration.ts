import User from "../models/User.js";
import ModerationLog from "../models/ModerationLog.js";
import Notification from "../models/Notification.js";
import { recordAudit } from "./audit/auditService.js";
import { AUDIT_ACTIONS } from "../models/AuditLog.js";

export class UserModerationService {
  async suspendUser({ adminId, userId, reason, durationDays, req }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    const days = parseInt(durationDays, 10) || 7;
    const suspendedUntil = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    user.isActive = false;
    user.lockUntil = suspendedUntil;
    await user.save();

    const modLog = await ModerationLog.create({
      admin: adminId,
      targetUser: userId,
      action: "suspend",
      reason,
      suspendedUntil,
    });

    await Notification.create({
      recipient: userId,
      sender: adminId,
      type: "system",
      title: "Account Suspended",
      message: `Your account has been suspended until ${suspendedUntil.toISOString()}. Reason: ${reason}`,
      priority: "high",
    }).catch(() => {});

    recordAudit({
      action: AUDIT_ACTIONS.ROLE_CHANGE,
      actor: adminId,
      req,
      targetType: "User",
      targetId: String(userId),
      status: "success",
      metadata: {
        reason,
        suspendedUntil: suspendedUntil.toISOString(),
      },
    });

    return { user, moderationLog: modLog };
  }

  async banUser({ adminId, userId, reason, req }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.isActive = false;
    user.lockUntil = new Date(8640000000000000);
    await user.save();

    const modLog = await ModerationLog.create({
      admin: adminId,
      targetUser: userId,
      action: "ban",
      reason,
    });

    await Notification.create({
      recipient: userId,
      sender: adminId,
      type: "system",
      title: "Account Permanently Banned",
      message: `Your account has been permanently banned. Reason: ${reason}`,
      priority: "urgent",
    }).catch(() => {});

    recordAudit({
      action: AUDIT_ACTIONS.ROLE_CHANGE,
      actor: adminId,
      req,
      targetType: "User",
      targetId: String(userId),
      status: "success",
      metadata: {
        reason,
      },
    });

    return { user, moderationLog: modLog };
  }

  async unbanUser({ adminId, userId, reason, req }) {
    const user = await User.findById(userId);
    if (!user) {
      throw new Error("User not found");
    }

    user.isActive = true;
    user.lockUntil = null;
    await user.save();

    const modLog = await ModerationLog.create({
      admin: adminId,
      targetUser: userId,
      action: "unban",
      reason,
    });

    await Notification.create({
      recipient: userId,
      sender: adminId,
      type: "system",
      title: "Account Reinstated",
      message: "Your account has been reinstated by administration.",
      priority: "medium",
    }).catch(() => {});

    recordAudit({
      action: AUDIT_ACTIONS.ROLE_CHANGE,
      actor: adminId,
      req,
      targetType: "User",
      targetId: String(userId),
      status: "success",
      metadata: {
        reason,
      },
    });

    return { user, moderationLog: modLog };
  }

  async getModerationLogs({ page = 1, limit = 20, targetUser }) {
    const query = {};
    if (targetUser) query.targetUser = targetUser;

    const skip = (page - 1) * limit;
    const [logs, total] = await Promise.all([
      ModerationLog.find(query)
        .populate("admin", "name email role")
        .populate("targetUser", "name email role isActive")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ModerationLog.countDocuments(query),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export default new UserModerationService();
