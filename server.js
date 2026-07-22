import app from "./app.js";
import logger from "./src/config/logger.js";
import { initRedis, closeRedis } from "./src/config/redis.js";
import { startJobs, stopJobs } from "./src/jobs/queue.js";
import { startAnchorPoller, stopAnchorPoller } from "./src/jobs/anchorPoller.js";
import "./src/jobs/handlers.js";

const PORT = process.env.PORT || 5000;

// Initialize Redis
initRedis().catch((err) => {
  logger.warn(
    "⚠️  Redis initialization failed, continuing without cache:",
    err.message
  );
});

const server = app.listen(PORT, () => {
  logger.info(`🚀🕌 DeenBridge API running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.info(`Process ID: ${process.pid}`);
});

startJobs().catch((err) => logger.error(err, "Background job startup failed"));
startAnchorPoller();

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info("HTTP server closed");

    await stopJobs();
    await stopAnchorPoller();

    // Close Redis connection
    await closeRedis();

    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    logger.error("Forced shutdown after timeout");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
