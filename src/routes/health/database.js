import express from "express";
import { checkDatabaseHealth } from "../../../mongo/utils/healthCheck.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await checkDatabaseHealth();
    const statusCode = result.healthy ? 200 : 503;
    return res.status(statusCode).json({
      success: result.healthy,
      message: result.healthy
        ? "Database connection is healthy"
        : "Database connection is unhealthy",
      data: result,
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: "Database health check failed",
      data: {
        healthy: false,
        status: "unhealthy",
        error: error.message,
      },
    });
  }
});

export default router;
