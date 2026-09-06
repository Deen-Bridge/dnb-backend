/**
 * Emitter helpers pushing payment status changes to connected clients.
 * ---------------------------------------------------------------------------
 * All emits are no-ops when Socket.io is not running (workers, tests, scripts)
 * so payment code paths never depend on the gateway being up.
 *
 * Events and payload shapes are defined in ./paymentEvents.js — import the
 * constants from there rather than inlining strings.
 */
import logger from "../config/logger.js";
import { getIO } from "./index.js";
import {
  PAYMENT_STATUS_EVENT,
  toClientStatus,
  userRoom,
  paymentRoom,
} from "./paymentEvents.js";

/**
 * Build the client-facing payload from a Transaction document.
 *
 * @param {object} transaction A Transaction document (or lean object).
 * @returns {import("./paymentEvents.js").PaymentStatusEvent}
 */
function buildStatusPayload(transaction) {
  return {
    transactionId: String(transaction._id),
    reference: transaction.expectedHash ?? undefined,
    status: toClientStatus(transaction.status),
    rawStatus: transaction.status,
    type: transaction.type,
    itemTitle: transaction.itemTitle ?? undefined,
    amount: transaction.amount,
    currency: transaction.currency ?? "USDC",
    stellarTxHash: transaction.stellarTxHash ?? undefined,
    failureReason: transaction.failureReason ?? undefined,
    updatedAt:
      transaction.updatedAt?.toISOString?.() ??
      new Date().toISOString(),
  };
}

/**
 * Notify every interested socket that a transaction's status changed.
 *
 * Fans out to:
 *   - the `payment:<txId>` room (opt-in subscribers),
 *   - the buyer's personal room,
 *   - the creator's personal room, for purchases.
 *
 * Safe to call with no Socket.io server running.
 *
 * @param {object} transaction Transaction document AFTER its save/update.
 * @returns {Promise<void>}
 */
export async function notifyPaymentStatus(transaction) {
  const socketServer = getIO();
  if (!socketServer) return;

  try {
    const payload = buildStatusPayload(transaction);
    const rooms = [paymentRoom(payload.transactionId)];

    if (transaction.buyer) {
      rooms.push(userRoom(String(transaction.buyer._id ?? transaction.buyer)));
    }
    if (transaction.creator) {
      rooms.push(
        userRoom(String(transaction.creator._id ?? transaction.creator))
      );
    }

    for (const room of rooms) {
      socketServer.to(room).emit(PAYMENT_STATUS_EVENT, payload);
    }
  } catch (err) {
    // Realtime is best-effort: a fan-out failure must never break payments.
    logger.error(
      { err, transactionId: String(transaction?._id ?? "") },
      "Failed to emit payment status update"
    );
  }
}

/**
 * Convenience wrapper for flows that persist via `findOneAndUpdate` and hold
 * only a plain result object instead of a full document.
 *
 * @param {object} rawTransaction Lean object with at least `_id` and `status`.
 */
export async function notifyPaymentStatusLean(rawTransaction) {
  if (!rawTransaction) return;
  await notifyPaymentStatus({
    ...rawTransaction,
    updatedAt: rawTransaction.updatedAt ?? new Date(),
  });
}
