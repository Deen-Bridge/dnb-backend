import UserStreak from "../models/UserStreak.js";

const MILESTONES = [7, 30, 100];

export const recordActivity = async (userId: string, activityType: string = "general") => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let streak = await UserStreak.findOne({ user: userId });
  if (!streak) {
    streak = new UserStreak({
      user: userId,
      currentStreak: 0,
      longestStreak: 0,
      streakFreezes: 1,
      milestonesReached: [],
      activityHistory: [],
    });
  }

  const lastActive = streak.lastActiveDate ? new Date(streak.lastActiveDate) : null;
  if (lastActive) {
    lastActive.setHours(0, 0, 0, 0);
  }

  const diffDays = lastActive ? Math.round((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24)) : null;

  if (diffDays === 0) {
    // Already active today, just ensure activity logged or return current
    return streak;
  } else if (diffDays === 1) {
    streak.currentStreak += 1;
  } else if (diffDays !== null && diffDays > 1) {
    // Check if streak freeze can protect
    const gap = diffDays - 1;
    if (streak.streakFreezes >= gap) {
      streak.streakFreezes -= gap;
      streak.currentStreak += 1;
    } else {
      streak.currentStreak = 1;
    }
  } else {
    streak.currentStreak = 1;
  }

  if (streak.currentStreak > streak.longestStreak) {
    streak.longestStreak = streak.currentStreak;
  }

  streak.lastActiveDate = new Date();
  streak.activityHistory.push({ date: new Date(), activityType });

  // Check milestones
  for (const m of MILESTONES) {
    if (streak.currentStreak >= m) {
      const alreadyReached = streak.milestonesReached.some((item: any) => item.milestone === m);
      if (!alreadyReached) {
        streak.milestonesReached.push({ milestone: m, reachedAt: new Date() });
      }
    }
  }

  await streak.save();
  return streak;
};

export const getStreakStatus = async (userId: string) => {
  let streak = await UserStreak.findOne({ user: userId });
  if (!streak) {
    streak = await UserStreak.create({
      user: userId,
      currentStreak: 0,
      longestStreak: 0,
      streakFreezes: 1,
    });
  }
  return streak;
};

export const useStreakFreeze = async (userId: string) => {
  const streak = await UserStreak.findOne({ user: userId });
  if (!streak) {
    throw new Error("Streak record not found");
  }
  if (streak.streakFreezes <= 0) {
    throw new Error("No streak freezes available");
  }
  streak.streakFreezes -= 1;
  await streak.save();
  return streak;
};

export const checkDailyStreaksJob = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const streaks = await UserStreak.find({});
  for (const streak of streaks) {
    if (!streak.lastActiveDate) continue;
    const lastActive = new Date(streak.lastActiveDate);
    lastActive.setHours(0, 0, 0, 0);

    const diffDays = Math.round((today.getTime() - lastActive.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays > 1) {
      const gap = diffDays - 1;
      if (streak.streakFreezes >= gap) {
        streak.streakFreezes -= gap;
      } else {
        streak.currentStreak = 0;
      }
      await streak.save();
    }
  }
};
