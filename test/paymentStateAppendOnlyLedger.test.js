import { describe, test, expect } from "@jest/globals";
import { PaymentStateAppendOnlyLedger } from "../src/services/paymentStateAppendOnlyLedger.js";

describe("Append-only ledger of verified payment state changes (#481)", () => {
  test("records transitions chronologically and deduplicates repeated webhooks", () => {
    const ledger = new PaymentStateAppendOnlyLedger();
    ledger.appendEvent({
      idempotencyKey: "evt-1",
      intentId: "pay-100",
      eventType: "created",
      actorSource: "checkout_api",
    });
    ledger.appendEvent({
      idempotencyKey: "evt-2",
      intentId: "pay-100",
      eventType: "verified",
      actorSource: "horizon_poller",
      transactionRef: "a".repeat(64),
    });
    const dup = ledger.appendEvent({
      idempotencyKey: "evt-2",
      intentId: "pay-100",
      eventType: "verified",
      actorSource: "horizon_poller",
      transactionRef: "a".repeat(64),
    });
    expect(dup.deduplicated).toBe(true);

    const trail = ledger.getIntentAuditTrail("pay-100");
    expect(trail.currentStatus).toBe("verified");
    expect(trail.transitions).toHaveLength(2);
  });
});
