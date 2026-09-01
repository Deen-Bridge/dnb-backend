import { checkDailyStreaksJob } from "../services/streakTracker.js";

export const updateStreaksJob = async () => {
  try {
    console.log("Running daily streak update job...");
    await checkDailyStreaksJob();
    console.log("Daily streak update job completed successfully.");
  } catch (error) {
    console.error("Error running daily streak update job:", error);
  }
};

export default updateStreaksJob;
