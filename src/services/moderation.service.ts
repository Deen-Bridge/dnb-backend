import ContentFlag from "../models/content-flag.model.ts";
import ModerationAction from "../models/moderation-action.model.ts";
import Reel from "../models/Reel.js";
import Notification from "../models/Notification.js";

const DEFAULT_PROHIBITED_KEYWORDS = [
  "hate",
  "scam",
  "violence",
  "abuse",
  "explicit",
  "spam",
  "illegal",
  "offensive",
  "nude",
  "porn",
  "gambling",
  "harassment",
];

export class ModerationService {
  /**
   * Check text content for prohibited keywords.
   */
  checkKeywords(text: string, keywords: string[] = DEFAULT_PROHIBITED_KEYWORDS): string[] {
    if (!text) return [];
    const lowerText = text.toLowerCase();
    return keywords.filter((kw) => {
      const regex = new RegExp(`\\b${kw}\\b`, "i");
      return regex.test(lowerText);
    });
  }

  /**
   * Automatically flag a reel if it contains inappropriate keyword content.
   */
  async autoFlagReel(reel: any) {
    const textToScan = `${reel.title || ""} ${reel.description || ""} ${(reel.tags || []).join(" ")}`;
    const matchedKeywords = this.checkKeywords(textToScan);

    if (matchedKeywords.length > 0) {
      const flag = await ContentFlag.create({
        reel: reel._id,
        reporter: null,
        reason: "Auto-flagged keyword filter",
        details: `Content matched flagged keywords: ${matchedKeywords.join(", ")}`,
        status: "pending",
        isAutoFlagged: true,
        flaggedKeywords: matchedKeywords,
      });

      return flag;
    }

    return null;
  }

  /**
   * User flags a reel for inappropriate content.
   */
  async flagReel({
    reelId,
    reporterId,
    reason,
    details,
  }: {
    reelId: string;
    reporterId: string;
    reason: string;
    details?: string;
  }) {
    const reel = await Reel.findById(reelId);
    if (!reel) {
      throw new Error("Reel not found");
    }

    const flag = await ContentFlag.create({
      reel: reelId,
      reporter: reporterId,
      reason,
      details,
      status: "pending",
      isAutoFlagged: false,
    });

    return flag;
  }

  /**
   * Fetch admin moderation queue for flagged reels.
   */
  async getModerationQueue({
    status = "pending",
    page = 1,
    limit = 20,
  }: {
    status?: string;
    page?: number;
    limit?: number;
  }) {
    const query: any = {};
    if (status && status !== "all") {
      query.status = status;
    }

    const skip = (page - 1) * limit;
    const [flags, total] = await Promise.all([
      ContentFlag.find(query)
        .populate("reel")
        .populate("reporter", "name email avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ContentFlag.countDocuments(query),
    ]);

    return {
      flags,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Process a moderation action (approve, reject, remove) on a flagged reel.
   */
  async processModerationAction({
    flagId,
    reelId,
    adminId,
    action,
    notes,
  }: {
    flagId?: string;
    reelId?: string;
    adminId: string;
    action: "approve" | "reject" | "remove";
    notes?: string;
  }) {
    let flag: any = null;
    if (flagId) {
      flag = await ContentFlag.findById(flagId);
    } else if (reelId) {
      flag = await ContentFlag.findOne({ reel: reelId, status: "pending" });
    }

    const targetReelId = flag ? flag.reel : reelId;
    const reel = await Reel.findById(targetReelId);
    if (!reel) {
      throw new Error("Reel not found");
    }

    let updatedStatus = "pending";
    if (action === "approve") {
      updatedStatus = "approved";
    } else if (action === "reject") {
      updatedStatus = "rejected";
    } else if (action === "remove") {
      updatedStatus = "removed";
      // Perform content removal (mark reel removed / inactive or delete)
      reel.status = "removed";
      reel.isRemoved = true;
      await reel.save();
    }

    if (flag) {
      flag.status = updatedStatus;
      await flag.save();
    }

    const moderationAction = await ModerationAction.create({
      flag: flag ? flag._id : undefined,
      reel: reel._id,
      admin: adminId,
      action,
      notes,
    });

    // Notify content creator of moderation decision
    const creatorId = reel.user || reel.author || reel.creator;
    if (creatorId) {
      const decisionText =
        action === "remove"
          ? "has been removed due to community guideline violations."
          : action === "approve"
          ? "has been reviewed and approved."
          : "flag review has been resolved.";

      await Notification.create({
        recipient: creatorId,
        sender: adminId,
        type: "system",
        title: "Reel Moderation Notice",
        message: `Your reel "${reel.title || "Content"}" ${decisionText}`,
        data: { reelId: reel._id },
        priority: action === "remove" ? "high" : "medium",
      }).catch((err) => {
        // Notification creation logging fallback
      });
    }

    return {
      flag,
      moderationAction,
      reel,
    };
  }

  /**
   * Retrieve moderation history and audit log.
   */
  async getModerationHistory({
    reelId,
    adminId,
    page = 1,
    limit = 20,
  }: {
    reelId?: string;
    adminId?: string;
    page?: number;
    limit?: number;
  }) {
    const query: any = {};
    if (reelId) query.reel = reelId;
    if (adminId) query.admin = adminId;

    const skip = (page - 1) * limit;
    const [actions, total] = await Promise.all([
      ModerationAction.find(query)
        .populate("reel")
        .populate("admin", "name email avatar")
        .populate("flag")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ModerationAction.countDocuments(query),
    ]);

    return {
      actions,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}

export const moderationService = new ModerationService();
export default moderationService;
