// controllers/analytics/activeUsersController.js
import logger from "../../config/logger.js";
import activeUsersService from "../../services/analytics/activeUsersService.js";

/**
 * GET /api/analytics/active-users
 * Return the current number of concurrent active users (unique users seen
 * within the configured inactivity window).
 */
export const getActiveUsers = async (req, res) => {
  try {
    const activeUsers = await activeUsersService.getActiveUserCount();
    res.status(200).json({
      success: true,
      activeUsers,
      timeoutSeconds: activeUsersService.getTimeoutSeconds(),
    });
  } catch (error) {
    logger.error("Failed to retrieve active user count:", error);
    res.status(500).json({
      success: false,
      message: "Failed to retrieve active user count",
    });
  }
};
