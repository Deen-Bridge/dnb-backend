import Announcement from "../models/Announcement.js";
import logger from "../config/logger.js";

export const publishScheduledAnnouncements = async (): Promise<void> => {
  try {
    const now = new Date();
    const result = await Announcement.updateMany(
      {
        status: "scheduled",
        scheduledFor: { $lte: now },
      },
      {
        $set: { status: "published" },
      }
    );

    if (result.modifiedCount > 0) {
      logger.info(`Published ${result.modifiedCount} scheduled announcements.`);
    }
  } catch (error) {
    logger.error("Error publishing scheduled announcements:", error);
  }
};

export default publishScheduledAnnouncements;
