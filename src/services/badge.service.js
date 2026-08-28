import Badge from "../models/badge.model.js";
import UserBadge from "../models/user-badge.model.js";
import CourseProgress from "../models/CourseProgress.js";
import { DEFAULT_BADGES } from "../utils/badge-criteria.js";

export class BadgeService {
  async seedDefaultBadges() {
    for (const b of DEFAULT_BADGES) {
      await Badge.findOneAndUpdate(
        { slug: b.slug },
        { $setOnInsert: b },
        { upsert: true, new: true }
      );
    }
  }

  async checkAndAwardBadges(userId) {
    await this.seedDefaultBadges();

    const completedProgresses = await CourseProgress.find({
      user: userId,
      $or: [{ percentComplete: 100 }, { completedAt: { $ne: null } }],
    }).populate("course", "category");

    const completedCount = completedProgresses.length;

    const categoryCounts = {};
    for (const cp of completedProgresses) {
      if (cp.course && cp.course.category) {
        const cat = cp.course.category;
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1;
      }
    }

    const maxCategoryCount = Math.max(0, ...Object.values(categoryCounts));
    const badges = await Badge.find();
    const newlyAwarded = [];

    for (const badge of badges) {
      let isEligible = false;

      if (badge.criteriaType === "courses_completed") {
        isEligible = completedCount >= badge.threshold;
      } else if (badge.criteriaType === "category_completed") {
        isEligible = maxCategoryCount >= badge.threshold;
      }

      if (isEligible) {
        const existing = await UserBadge.findOne({ user: userId, badge: badge._id });
        if (!existing) {
          try {
            const userBadge = await UserBadge.create({
              user: userId,
              badge: badge._id,
              metadata: {
                completedCount,
                maxCategoryCount,
              },
            });
            const populated = await UserBadge.findById(userBadge._id).populate("badge");
            newlyAwarded.push(populated);
          } catch (err) {
            if (!err.message?.includes("E11000") && err.code !== 11000) {
              throw err;
            }
          }
        }
      }
    }

    return newlyAwarded;
  }

  async getUserBadges(userId) {
    await this.checkAndAwardBadges(userId);
    return await UserBadge.find({ user: userId })
      .populate("badge")
      .sort({ awardedAt: -1 });
  }

  async getAllBadges() {
    await this.seedDefaultBadges();
    return await Badge.find().sort({ threshold: 1 });
  }
}

export default new BadgeService();
