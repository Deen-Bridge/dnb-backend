import { describe, test, expect } from "@jest/globals";
import { runRestoreReconciliationDrill } from "../src/services/paymentRestoreReconciliationDrill.js";

describe("Restore drill and Stellar history reconciliation (#482)", () => {
  test("idempotently reconciles post-snapshot on-chain settlements within RTO/RPO targets", () => {
    const dbSnapshot = [{ intentId: "intent-1", status: "submitted", txHash: null }];
    const chainHistory = [
      { intentId: "intent-1", onChainStatus: "verified", txHash: "a".repeat(64) },
      { intentId: "intent-2", onChainStatus: "verified", txHash: "b".repeat(64) },
    ];

    const firstDrill = runRestoreReconciliationDrill({
      restoredDbRecords: dbSnapshot,
      onChainEvents: chainHistory,
      drillDurationMinutes: 12,
      snapshotAgeMinutes: 3,
    });
    expect(firstDrill.meetsSlo).toBe(true);
    expect(firstDrill.reconciledCount).toBe(2);

    const secondDrill = runRestoreReconciliationDrill({
      restoredDbRecords: firstDrill.finalRecords,
      onChainEvents: chainHistory,
      drillDurationMinutes: 12,
      snapshotAgeMinutes: 3,
    });
    expect(secondDrill.reconciledCount).toBe(0);
  });
});
