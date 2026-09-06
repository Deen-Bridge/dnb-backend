/**
 * Socket.io gateway for authenticated real-time payment updates.
 * ---------------------------------------------------------------------------
 * Handles the lifecycle of a payment websocket connection:
 *
 *   1. **Handshake auth** — mirrors `authMiddleware.protect`: the client must
 *      present a valid JWT (in `auth.token`, an `Authorization: Bearer` header,
 *      or the `authToken` cookie). The token is verified and the user must
 *      still exist; otherwise the connection is rejected before any handler
 *      runs. Defense in depth only — authorization of *data* is still enforced
 *      by ownership checks below.
 *   2. **Personal room** — every authenticated socket automatically joins
 *      `user:<userId>` so user-scoped payment events can reach all its tabs.
 *   3. **Transaction rooms** — clients may opt into `payment:<txId>` rooms via
 *      the subscribe handlers. Joining is only allowed when the authenticated
 *      user is the buyer or the creator (donations have no creator) of that
 *      transaction, so payment details never leak across accounts.
 */
import mongoose from "mongoose";
import jwt from "jsonwebtoken";
import logger from "../config/logger.js";
import User from "../models/User.js";
import {
  PAYMENT_ACK,
  SUBSCRIBE_PAYMENT,
  UNSUBSCRIBE_PAYMENT,
  userRoom,
  paymentRoom,
} from "./paymentEvents.js";

/**
 * Lazily resolve the Transaction model instead of importing it statically so
 * this module keeps a one-way dependency direction (sockets → models stays
 * runtime-only, avoiding an import cycle with Transaction's save hook).
 */
function transactionModel() {
  return mongoose.model("Transaction");
}

const JWT_SECRET = process.env.JWT_SECRET || "deenbridge-temp-secret-key-2024";

/** Extract the JWT from wherever our REST clients legitimately put it. */
function extractToken(auth = {}) {
  if (auth.token) return auth.token;

  const header = auth.headers?.authorization ?? auth.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice(7);
  }

  // Same cookie name the REST session flow sets (js-cookie on the frontend).
  const rawCookie = auth.cookie;
  if (typeof rawCookie === "string") {
    const match = /(?:^|;\s*)authToken=([^;]+)/.exec(rawCookie);
    if (match) return decodeURIComponent(match[1]);
  }
  return null;
}

/**
 * Socket.io middleware: authenticate the handshake or reject it.
 * Mirrors the checks performed by `protect` in authMiddleware.js.
 */
async function authenticateSocket(socket, next) {
  try {
    const token = extractToken(socket.handshake.auth);
    if (!token) return next(new Error("No token, authorization denied"));

    let decoded;
    try {
      decoded = jwt.verify(token, JWT_SECRET);
    } catch {
      return next(new Error("Not authorized, token failed"));
    }

    const user = await User.findById(decoded.userId).select("_id");
    if (!user) return next(new Error("User not found"));

    socket.data.userId = String(user._id);
    next();
  } catch (err) {
    logger.error(err, "Socket authentication failed unexpectedly");
    next(new Error("Authentication error"));
  }
}

/**
 * Subscribe a socket to one transaction's room after an ownership check.
 * Accepts either the transaction `_id` or its `expectedHash` reference.
 */
async function handleSubscribe(socket, payload, callback) {
  const ack =
    typeof callback === "function"
      ? callback
      : () => {}; // fire-and-forget callers still work

  try {
    const identifier = payload?.transactionId ?? payload?.reference;
    if (!identifier || typeof identifier !== "string") {
      return ack({ ok: false, error: "transactionId is required" });
    }

    const filter = mongoose.isValidObjectId(identifier)
      ? { _id: identifier }
      : { expectedHash: identifier };

    const transaction = await transactionModel()
      .findById(filter)
      .select("buyer creator")
      .lean();
    if (!transaction) {
      return ack({ ok: false, error: "Transaction not found" });
    }

    const userId = socket.data.userId;
    const isBuyer = transaction.buyer && String(transaction.buyer) === userId;
    const isCreator =
      transaction.creator && String(transaction.creator) === userId;
    if (!isBuyer && !isCreator) {
      logger.warn(
        { userId, transactionId: String(transaction._id) },
        "Blocked payment room subscription — not a party to the transaction"
      );
      return ack({ ok: false, error: "Not authorized for this transaction" });
    }

    const room = paymentRoom(String(transaction._id));
    await socket.join(room);
    return ack({ ok: true, room });
  } catch (err) {
    logger.error(err, "payment:subscribe failed");
    return ack({ ok: false, error: "Subscription failed" });
  }
}

/** Remove a socket from a transaction room it previously joined. */
async function handleUnsubscribe(socket, payload, callback) {
  const ack = typeof callback === "function" ? callback : () => {};
  const identifier = payload?.transactionId ?? payload?.reference;
  if (!identifier || typeof identifier !== "string") {
    return ack({ ok: false, error: "transactionId is required" });
  }
  await socket.leave(paymentRoom(String(identifier)));
  return ack({ ok: true });
}

/**
 * Register connection handling + rooms on a Socket.io server instance.
 * Called once from initSockets() in ./index.js.
 */
export function registerPaymentGateway(io) {
  io.use(authenticateSocket);

  io.on("connection", async (socket) => {
    // Personal room so events can target a user across tabs/devices.
    await socket.join(userRoom(socket.data.userId));
    logger.debug(
      { userId: socket.data.userId, socketId: socket.id },
      "Payment socket connected"
    );

    socket.on(SUBSCRIBE_PAYMENT, (payload, cb) =>
      handleSubscribe(socket, payload, cb)
    );
    socket.on(UNSUBSCRIBE_PAYMENT, (payload, cb) =>
      handleUnsubscribe(socket, payload, cb)
    );
    socket.on(PAYMENT_ACK, () => {
      /* reserved for future ack-only probes */
    });

    socket.on("disconnect", (reason) => {
      logger.debug(
        { userId: socket.data.userId, socketId: socket.id, reason },
        "Payment socket disconnected"
      );
    });
  });
}
