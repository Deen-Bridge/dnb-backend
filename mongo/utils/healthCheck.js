import mongoose from "mongoose";

/**
 * Checks MongoDB database health by inspecting connection state and issuing a ping command.
 * Returns health status, response time, and connection details.
 *
 * @param {Object} options
 * @param {number} [options.timeoutMs=3000] Ping timeout in milliseconds
 * @returns {Promise<{healthy: boolean, status: string, responseTimeMs: number, connection: Object, error?: string}>}
 */
export async function checkDatabaseHealth({ timeoutMs = 3000 } = {}) {
  const startTime = Date.now();
  const readyState = mongoose.connection ? mongoose.connection.readyState : 0;
  const stateNames = {
    0: "disconnected",
    1: "connected",
    2: "connecting",
    3: "disconnecting",
  };

  const connectionDetails = {
    readyState: stateNames[readyState] || "unknown",
    host: mongoose.connection?.host || null,
    port: mongoose.connection?.port || null,
    name: mongoose.connection?.name || null,
  };

  if (readyState !== 1 || !mongoose.connection?.db) {
    return {
      healthy: false,
      status: "unhealthy",
      responseTimeMs: Date.now() - startTime,
      connection: connectionDetails,
      error: `MongoDB is not connected (state: ${stateNames[readyState] || readyState})`,
    };
  }

  try {
    const pingPromise = mongoose.connection.db.admin().ping();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Database ping timeout")), timeoutMs)
    );

    await Promise.race([pingPromise, timeoutPromise]);
    const responseTimeMs = Date.now() - startTime;

    return {
      healthy: true,
      status: "healthy",
      responseTimeMs,
      connection: connectionDetails,
    };
  } catch (error) {
    return {
      healthy: false,
      status: "unhealthy",
      responseTimeMs: Date.now() - startTime,
      connection: connectionDetails,
      error: error.message || "Database ping failed",
    };
  }
}
