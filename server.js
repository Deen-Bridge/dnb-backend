import dotenv from "dotenv";
import logger from "./src/config/logger.js";
import connectDB from "./src/config/db.js";
import validateEnv from "./src/config/validateEnv.js";
import { initRedis, closeRedis } from "./src/config/redis.js";
import { startJobs, stopJobs } from "./src/jobs/queue.js";
import {
  handleUncaughtException,
  handleUnhandledRejection,
} from "./src/middlewares/errorHandler.js";
import "./src/jobs/handlers.js";

dotenv.config();
handleUncaughtException();
validateEnv();
await connectDB();
handleUnhandledRejection();

const { default: app } = await import("./app.js");
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

// Start outbound webhook delivery worker if enabled
let stopWebhookWorker;
if (process.env.WEBHOOK_WORKER_ENABLED === "true") {
  import("./src/services/webhooks/deliveryWorker.js").then(
    ({ startDeliveryWorker, stopDeliveryWorker: stopFn }) => {
      stopWebhookWorker = stopFn;
      startDeliveryWorker().catch((err) =>
        logger.error(err, "Webhook delivery worker startup failed")
      );
    }
  );
}

let stopPledgeScheduler;
if (process.env.PLEDGE_SCHEDULER_ENABLED === "true") {
  import("./src/workers/pledgeScheduler.js").then(
    ({ startPledgeScheduler, stopPledgeScheduler: stopFn }) => {
      stopPledgeScheduler = stopFn;
      startPledgeScheduler().catch((err) =>
        logger.error(err, "Pledge scheduler startup failed")
      );
    }
  );
}

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  logger.info(`${signal} received. Starting graceful shutdown...`);

  server.close(async () => {
    logger.info("HTTP server closed");

    await stopJobs();

    if (stopIngestionWorker) {
      await stopIngestionWorker();
    }

    if (stopWebhookWorker) {
      await stopWebhookWorker();
    }

    if (stopPledgeScheduler) {
      await stopPledgeScheduler();
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
