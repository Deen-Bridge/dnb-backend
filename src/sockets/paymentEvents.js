/**
 * Payment event contracts for the Socket.io real-time notification channel.
 * ---------------------------------------------------------------------------
 * This module is the single source of truth for every event name and payload
 * shape emitted over the payment namespace. It is the equivalent of a DTO
 * layer for our WebSocket surface: clients (and tests) should import the
 * constants from here instead of hard-coding strings, and the JSDoc typedefs
 * below document exactly what each event carries.
 *
 * Rooms
 * -----
 *   - `user:<userId>`        — every connected socket joins its own room on
 *                              authentication; user-scoped events land here.
 *   - `payment:<txId>`       — opt-in room for a specific transaction. A
 *                              socket may only join it if its authenticated
 *                              user is the buyer or the creator of that
 *                              transaction (see paymentGateway.js).
 *
 * Status mapping
 * --------------
 * Internal Transaction statuses are normalized to the coarse client-facing
 * statuses required by the realtime contract:
 *
 *   pending | submitted | retrying            → "pending"
 *   confirmed                                 → "success"
 *   failed | expired | refunded | disputed    → "failed"
 *
 * The raw internal status always travels alongside in `payment.rawStatus` so
 * clients that need finer granularity can branch without a second event.
 */

/**
 * @typedef {"pending"|"submitted"|"retrying"|"confirmed"|"failed"|
 *           "expired"|"refunded"|"disputed"} InternalPaymentStatus
 * Raw status as stored on the Transaction document.
 */

/**
 * @typedef {"pending"|"success"|"failed"} ClientPaymentStatus
 * Normalized status pushed to clients.
 */

/**
 * Payload for the `payment:status` event.
 *
 * @typedef {object} PaymentStatusEvent
 * @property {string}   transactionId  Transaction `_id`.
 * @property {string}   [reference]    `expectedHash` of the transaction, when
 *                                     set — the client-side checkout handle.
 * @property {ClientPaymentStatus} status    Normalized lifecycle status.
 * @property {InternalPaymentStatus} rawStatus Raw stored status.
 * @property {("purchase"|"donation")} type     Transaction kind.
 * @property {string}   [itemTitle]    Title of the purchased item (purchases).
 * @property {string}   amount         Amount as a precision-preserving string.
 * @property {string}   currency       Asset code (e.g. "USDC").
 * @property {string}   [stellarTxHash] On-chain hash once submitted.
 * @property {string}   [failureReason] Why the payment failed, when it did.
 * @property {string}   updatedAt      ISO timestamp of the transition.
 */

/** Event emitted whenever a transaction's status changes. */
export const PAYMENT_STATUS_EVENT = "payment:status";

/** Client → server: ask to follow one specific transaction's updates. */
export const SUBSCRIBE_PAYMENT = "payment:subscribe";

/** Client → server: stop following a previously subscribed transaction. */
export const UNSUBSCRIBE_PAYMENT = "payment:unsubscribe";

/** Server → client: ack/error reply to subscribe/unsubscribe requests. */
export const PAYMENT_ACK = "payment:ack";

/**
 * Normalize an internal Transaction status into the client-facing one.
 *
 * @param {InternalPaymentStatus} rawStatus
 * @returns {ClientPaymentStatus}
 */
export function toClientStatus(rawStatus) {
  if (rawStatus === "confirmed") return "success";
  if (
    rawStatus === "failed" ||
    rawStatus === "expired" ||
    rawStatus === "refunded" ||
    rawStatus === "disputed"
  ) {
    return "failed";
  }
  return "pending";
}

/**
 * Build the room name holding every socket belonging to one user.
 *
 * @param {string} userId
 * @returns {string} e.g. "user:507f1f77bcf86cd799439011"
 */
export function userRoom(userId) {
  return `user:${userId}`;
}

/**
 * Build the opt-in room for a single transaction.
 *
 * @param {string} transactionId
 * @returns {string} e.g. "payment:507f1f77bcf86cd799439012"
 */
export function paymentRoom(transactionId) {
  return `payment:${transactionId}`;
}
