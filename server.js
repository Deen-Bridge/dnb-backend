import app, { setReadiness } from "./app.js";
import logger from "./src/config/logger.js";
import { initRedis, closeRedis } from "./src/config/redis.js";
import { startJobs, stopJobs } from "./src/jobs/queue.js";
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

// Start payment ingestion worker if enabled
let stopIngestionWorker;
if (process.env.INGESTION_WORKER_ENABLED === "true") {
  import("./src/workers/paymentIngestionWorker.js").then(
    ({ startIngestionWorker, stopIngestionWorker: stopFn }) => {
      stopIngestionWorker = stopFn;
      startIngestionWorker().catch((err) =>
        logger.error(err, "Ingestion worker startup failed")
      );
    }
  );
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  // FIRST: signal not ready so load balancer stops sending new requests
  setReadiness(false);

  // Give load balancer time to drain (adjust to your LB health check interval)
  // Typical health check intervals are 5-10 seconds
  await new Promise((resolve) => setTimeout(resolve, 5000));

  server.close(async () => {
    logger.info("HTTP server closed");

    await stopJobs();

    if (stopIngestionWorker) {
      await stopIngestionWorker();
    }

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
