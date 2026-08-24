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
 */
import { Server } from "socket.io";
import logger from "../config/logger.js";
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
  logger.info("🔌 Socket.io payment gateway ready");

  return io;
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
  logger.info("Socket.io connections closed");
}
