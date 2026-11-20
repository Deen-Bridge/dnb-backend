import express from "express";
import { checkDatabaseHealth } from "../../../mongo/utils/healthCheck.js";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";

const router = express.Router();

router.get("/", protect, authorizeRoles("admin"), async (req, res) => {
  try {
    const result = await checkDatabaseHealth();
    const statusCode = result.healthy ? 200 : 503;
    return res.status(statusCode).json({
      success: result.healthy,
      message: result.healthy
        ? "Database connection is healthy"
        : "Database connection is unhealthy",
      data: {
        healthy: Boolean(result.healthy),
        status: result.healthy ? "healthy" : "unhealthy",
        responseTimeMs: result.responseTimeMs,
      },
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      message: "Database health check failed",
      data: { healthy: false, status: "unhealthy" },
    });
  }
});

export default router;
