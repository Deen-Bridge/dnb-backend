/**
 * Append-only ledger of verified payment state transitions (#481).
 */

export const ALLOWED_PAYMENT_EVENTS = new Set([
  "created",
  "submitted",
  "verified",
  "failed",
  "refunded",
  "reconciled",
]);

export class PaymentStateAppendOnlyLedger {
  constructor() {
    this._entries = [];
    this._idempotencyKeys = new Map();
  }

  appendEvent({
    idempotencyKey,
    intentId,
    eventType,
    actorSource,
    transactionRef = null,
    occurredAt = new Date().toISOString(),
  }) {
    if (!idempotencyKey || !intentId || !eventType || !actorSource) {
      throw new Error("idempotencyKey, intentId, eventType, and actorSource are required");
    }
    if (!ALLOWED_PAYMENT_EVENTS.has(eventType)) {
      throw new Error(`Unsupported payment eventType: ${eventType}`);
    }
    if (this._idempotencyKeys.has(idempotencyKey)) {
      return { deduplicated: true, entry: this._idempotencyKeys.get(idempotencyKey) };
    }

    const entry = Object.freeze({
      sequence: this._entries.length + 1,
      idempotencyKey,
      intentId,
      eventType,
      actorSource,
      transactionRef,
      occurredAt,
    });
    this._entries.push(entry);
    this._idempotencyKeys.set(idempotencyKey, entry);
    return { deduplicated: false, entry };
  }

  getIntentAuditTrail(intentId) {
    const history = this._entries.filter((e) => e.intentId === intentId);
    const currentStatus = history.length > 0 ? history[history.length - 1].eventType : "unknown";
    return {
      intentId,
      currentStatus,
      transitions: history,
    };
  }
}
