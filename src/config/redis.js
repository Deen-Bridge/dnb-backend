import { createClient } from "redis";
import logger from "./logger.js";

let redisClient = null;
let isReady = false;

/**
 * Initialize Redis client
 */
export const initRedis = async () => {
  try {
    // Create Redis client with cloud credentials
    const redisConfig = process.env.REDIS_URL
      ? {
          // Use connection URL if provided
          url: process.env.REDIS_URL,
          socket: {
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                logger.error("❌ Redis max reconnection attempts reached");
                return new Error("Redis max reconnection attempts");
              }
              return Math.min(retries * 100, 3000);
            },
          },
        }
      : {
          // Use separate credentials (Redis Cloud format)
          username: process.env.REDIS_USERNAME || "default",
          password: process.env.REDIS_PASSWORD,
          socket: {
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT || "6379"),
            reconnectStrategy: (retries) => {
              if (retries > 10) {
                logger.error("❌ Redis max reconnection attempts reached");
                return new Error("Redis max reconnection attempts");
              }
              return Math.min(retries * 100, 3000);
            },
          },
        };

    redisClient = createClient(redisConfig);

    // Error handling
    redisClient.on("error", (err) => {
      logger.error("Redis Client Error:", err);
      isReady = false;
    });

    redisClient.on("connect", () => {
      logger.info("🔄 Redis connecting...");
    });

    redisClient.on("ready", () => {
      logger.info("✅ Redis connected and ready");
      isReady = true;
    });

    redisClient.on("reconnecting", () => {
      logger.warn("⚠️  Redis reconnecting...");
      isReady = false;
    });

    redisClient.on("end", () => {
      logger.warn("⚠️  Redis connection closed");
      isReady = false;
    });

    // Connect to Redis
    await redisClient.connect();

    return redisClient;
  } catch (error) {
    logger.error("❌ Failed to connect to Redis:", error);
    // Don't throw error - app can work without Redis
    return null;
  }
};

/**
 * Get Redis client instance
 */
export const getRedisClient = () => {
  return redisClient;
};

/**
 * Check if Redis is ready
 */
export const isRedisReady = () => {
  return isReady && redisClient?.isOpen;
};

/**
 * Graceful shutdown
 */
export const closeRedis = async () => {
  try {
    if (redisClient && redisClient.isOpen) {
      await redisClient.quit();
      logger.info("✅ Redis connection closed gracefully");
    }
  } catch (error) {
    logger.error("Error closing Redis connection:", error);
  }
};

export default {
  initRedis,
  getRedisClient,
  isRedisReady,
  closeRedis,
};
