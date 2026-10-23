/**
 * Rehearse restoration of payment and scholarship records against Stellar on-chain history (#482).
 */

export const RESTORE_SLO_TARGETS = Object.freeze({
  maxRtoMinutes: 30,
  maxRpoMinutes: 5,
});

export function runRestoreReconciliationDrill({
  restoredDbRecords,
  onChainEvents,
  drillDurationMinutes,
  snapshotAgeMinutes,
}) {
  if (!Array.isArray(restoredDbRecords) || !Array.isArray(onChainEvents)) {
    throw new Error("restoredDbRecords and onChainEvents arrays are required");
  }

  const byIntent = new Map(restoredDbRecords.map((r) => [r.intentId, { ...r }]));
  const reconciledActions = [];

  for (const chainEv of onChainEvents) {
    const existing = byIntent.get(chainEv.intentId);
    if (!existing) {
      byIntent.set(chainEv.intentId, {
        intentId: chainEv.intentId,
        status: chainEv.onChainStatus,
        txHash: chainEv.txHash,
      });
      reconciledActions.push({ intentId: chainEv.intentId, action: "backfilled_from_chain" });
    } else if (existing.status !== chainEv.onChainStatus) {
      existing.status = chainEv.onChainStatus;
      existing.txHash = chainEv.txHash;
      reconciledActions.push({ intentId: chainEv.intentId, action: "updated_to_chain_state" });
    }
  }

  const meetsSlo =
    drillDurationMinutes <= RESTORE_SLO_TARGETS.maxRtoMinutes &&
    snapshotAgeMinutes <= RESTORE_SLO_TARGETS.maxRpoMinutes;

  return {
    meetsSlo,
    reconciledCount: reconciledActions.length,
    reconciledActions,
    finalRecords: [...byIntent.values()],
  };
}
