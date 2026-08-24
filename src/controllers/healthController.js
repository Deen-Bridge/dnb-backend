import mongoose from "mongoose";
import { isRedisReady } from "../config/redis.js";

const mongoStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

export const createHealthHandler = ({
  getMongoReadyState = () => mongoose.connection.readyState,
  getRedisReady = isRedisReady,
  getUptime = () => process.uptime(),
  getEnvironment = () => process.env.NODE_ENV || "unknown",
} = {}) => {
  return (_req, res) => {
    const mongoReadyState = getMongoReadyState();
    const mongoReady = mongoReadyState === 1;
    const redisReady = Boolean(getRedisReady());
    const healthy = mongoReady && redisReady;

    return res.status(healthy ? 200 : 503).json({
      success: healthy,
      message: healthy
        ? "All critical dependencies are ready"
        : "One or more critical dependencies are unavailable",
      data: {
        status: healthy ? "healthy" : "unhealthy",
        timestamp: new Date().toISOString(),
        uptime: getUptime(),
        environment: getEnvironment(),
        dependencies: {
          mongodb: {
            status: mongoReady ? "up" : "down",
            state: mongoStates[mongoReadyState] || "unknown",
          },
          redis: {
            status: redisReady ? "up" : "down",
          },
        },
      },
    });
  };
};

export const healthCheck = createHealthHandler();

export const ping = (_req, res) => res.status(200).send("pong");
