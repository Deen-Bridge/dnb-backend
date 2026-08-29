import Transaction from "../models/Transaction.js";
import CourseProgress from "../models/CourseProgress.js";
import Achievement from "../models/achievement.model.js";
import UserAchievement from "../models/user-achievement.model.js";
import GamificationProfile from "../models/gamification-profile.model.js";
import definitions from "../data/achievements.json" with { type: "json" };

const LEVEL_XP = 100;
export const levelForXp = (xp) => Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / LEVEL_XP)) + 1);

export async function seedAchievements() {
  await Promise.all(definitions.map((definition) => Achievement.findOneAndUpdate(
    { slug: definition.slug }, { $set: definition }, { upsert: true, new: true }
  )));
}

async function countsForUser(userId) {
  const [donations, courses] = await Promise.all([
    Transaction.countDocuments({ buyer: userId, type: "donation", status: "confirmed" }),
    CourseProgress.countDocuments({ user: userId, $or: [{ percentComplete: 100 }, { completedAt: { $ne: null } }] }),
  ]);
  return { donations, courses_completed: courses };
}

export async function evaluateUser(userId) {
  await seedAchievements();
  const counts = await countsForUser(userId);
  const profile = await GamificationProfile.findOneAndUpdate(
    { user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, new: true }
  );
  const achievements = await Achievement.find({}).sort({ threshold: 1 });
  const newlyAwarded = [];
  for (const achievement of achievements) {
    if ((counts[achievement.criteriaType] ?? 0) < achievement.threshold) continue;
    const awarded = await UserAchievement.findOneAndUpdate(
      { user: userId, achievement: achievement._id },
      { $setOnInsert: { user: userId, achievement: achievement._id, xpAwarded: achievement.xp } },
      { upsert: true, new: true, rawResult: true }
    );
    if (awarded.lastErrorObject?.updatedExisting === false) newlyAwarded.push(achievement);
  }
  const earned = await UserAchievement.find({ user: userId }).populate("achievement");
  const xp = earned.reduce((total, item) => total + (item.xpAwarded ?? item.achievement?.xp ?? 0), 0);
  profile.xp = xp;
  profile.level = levelForXp(xp);
  profile.lastEvaluatedAt = new Date();
  await profile.save();
  return { counts, profile, achievements: earned, newlyAwarded };
}

export async function getLeaderboard(limit = 25) {
  return GamificationProfile.find({}).sort({ xp: -1, level: -1 }).limit(Math.min(limit, 100)).populate("user", "name avatar stellarWallet.publicKey");
}
