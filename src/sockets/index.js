/**
 * Socket.io bootstrap for real-time payment notifications.
 * ---------------------------------------------------------------------------
 * Owns the singleton Socket.io server instance:
 *
 *   - `initSockets(httpServer)` — attach Socket.io to the HTTP server with
 *     CORS aligned to the REST API's allow-list and register the payment
 *     gateway. Call once from the server entrypoint.
 *   - `getIO()` — safe accessor used by emitters; returns `null` when sockets
 *     are not running (e.g. worker processes that import models but never
 *     start an HTTP server), so callers can no-op instead of crashing.
 *   - `closeSockets()` — graceful shutdown hook.
 *
 * Multi-instance note: with more than one API process (e.g. the k8s
 * deployment's 3 replicas), a bare Socket.io server only delivers events to
 * clients connected to the *same* process. `attachRedisAdapter` wires in
 * `@socket.io/redis-adapter`, reusing the app's existing Redis client, so
 * `io.emit`/`io.to(room).emit` fan out across every instance. If Redis is
 * unavailable it degrades to single-instance behavior (same pattern as
 * `src/config/redis.js`'s cache fallback) rather than failing startup.
 */
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import logger from "../config/logger.js";
import { getRedisClient } from "../config/redis.js";
import { registerPaymentGateway } from "./paymentGateway.js";

/** Origins allowed to open a websocket, kept in sync with app.js corsOptions. */
const ALLOWED_ORIGINS = [
  "https://dnb-frontend.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
  "https://deenbridge.vercel.app",
  "http://deenbridge.vercel.app",
];

/** @type {import("socket.io").Server|null} */
let io = null;

/** @type {import("redis").RedisClientType|null} */
let pubClient = null;
/** @type {import("redis").RedisClientType|null} */
let subClient = null;

/**
 * Attach Socket.io to the given HTTP server and wire up handlers.
 *
 * @param {import("http").Server} httpServer
 * @returns {import("socket.io").Server}
 */
export function initSockets(httpServer) {
  if (io) return io;

  io = new Server(httpServer, {
    cors: {
      origin(origin, callback) {
        // Non-browser clients (curl, workers) send no Origin header.
        if (!origin || ALLOWED_ORIGINS.includes(origin)) {
          return callback(null, true);
        }
        logger.warn({ origin }, "Blocked websocket connection from origin");
        return callback(new Error("Not allowed by CORS"));
      },
      credentials: true,
      methods: ["GET", "POST"],
    },
  });

  registerPaymentGateway(io);
  void runAttachRedisAdapter(io);
  logger.info("🔌 Socket.io payment gateway ready");

  return io;
}

/** Fire-and-forget wrapper so a Redis outage never blocks server startup. */
async function runAttachRedisAdapter(server) {
  try {
    await attachRedisAdapter(server);
  } catch (err) {
    logger.warn(
      { err: err.message },
      "Socket.io Redis adapter unavailable — running single-instance (events won't propagate across replicas)"
    );
  }
}

/**
 * Wire up the Redis adapter so emitted events reach clients connected to
 * other instances, not just this process. No-ops (logging a warning) when
 * Redis isn't configured, matching the rest of the app's "Redis is an
 * optional accelerant, not a hard dependency" convention.
 *
 * @param {import("socket.io").Server} server
 */
async function attachRedisAdapter(server) {
  const baseClient = getRedisClient();
  if (!baseClient) {
    logger.warn(
      "Socket.io running without Redis adapter (no Redis client) — events won't propagate across replicas"
    );
    return;
  }

  pubClient = baseClient.duplicate();
  subClient = baseClient.duplicate();

  pubClient.on("error", (err) => logger.error(err, "Socket.io Redis pub client error"));
  subClient.on("error", (err) => logger.error(err, "Socket.io Redis sub client error"));

  await Promise.all([pubClient.connect(), subClient.connect()]);

  server.adapter(createAdapter(pubClient, subClient));
  logger.info("🔌 Socket.io Redis adapter attached — events now shared across instances");
}

/**
 * Current Socket.io server, or null when sockets were never initialized.
 *
 * @returns {import("socket.io").Server|null}
 */
export function getIO() {
  return io;
}

/**
 * Disconnect every client and release the instance (graceful shutdown).
 */
export async function closeSockets() {
  if (!io) return;
  await new Promise((resolve) => io.close(() => resolve()));
  io = null;

  if (pubClient) {
    await pubClient.quit().catch(() => {});
    pubClient = null;
  }
  if (subClient) {
    await subClient.quit().catch(() => {});
    subClient = null;
  }

  logger.info("Socket.io connections closed");
}
