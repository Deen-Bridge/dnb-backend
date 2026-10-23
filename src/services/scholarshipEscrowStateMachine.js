/**
 * Define scholarship escrow milestone states and authorized API transitions (#478).
 */

export const ESCROW_STATES = Object.freeze({
  DRAFT: "draft",
  FUNDED: "funded",
  MILESTONE_PENDING: "milestone-pending",
  APPROVED: "approved",
  RELEASED: "released",
  DISPUTED: "disputed",
  EXPIRED: "expired",
  CANCELLED: "cancelled",
});

export const ESCROW_TRANSITION_TABLE = Object.freeze([
  { from: "draft", to: "funded", actor: "donor", auditEvent: "ESCROW_FUNDED" },
  { from: "draft", to: "cancelled", actor: "donor", auditEvent: "ESCROW_CANCELLED" },
  { from: "funded", to: "milestone-pending", actor: "beneficiary", auditEvent: "MILESTONE_SUBMITTED" },
  { from: "funded", to: "disputed", actor: "donor", auditEvent: "ESCROW_DISPUTED" },
  { from: "funded", to: "expired", actor: "system", auditEvent: "ESCROW_EXPIRED" },
  { from: "milestone-pending", to: "approved", actor: "arbiter", auditEvent: "MILESTONE_APPROVED" },
  { from: "milestone-pending", to: "disputed", actor: "arbiter", auditEvent: "MILESTONE_DISPUTED" },
  { from: "approved", to: "released", actor: "arbiter", auditEvent: "FUNDS_RELEASED" },
  { from: "disputed", to: "approved", actor: "arbiter", auditEvent: "DISPUTE_RESOLVED_APPROVE" },
  { from: "disputed", to: "cancelled", actor: "arbiter", auditEvent: "DISPUTE_RESOLVED_REFUND" },
]);

export function transitionEscrowState({
  currentState,
  targetState,
  actorRole,
  environment = "development",
  contractId = null,
}) {
  const rule = ESCROW_TRANSITION_TABLE.find(
    (entry) => entry.from === currentState && entry.to === targetState
  );
  if (!rule) {
    throw new Error(`Invalid escrow state transition from '${currentState}' to '${targetState}'`);
  }
  if (rule.actor !== actorRole) {
    throw new Error(
      `Actor '${actorRole}' is not authorized for transition '${currentState}' -> '${targetState}' (requires '${rule.actor}')`
    );
  }
  const isMainnet = environment === "mainnet" && Boolean(contractId);
  return {
    previousState: currentState,
    state: targetState,
    actorRole,
    auditEvent: rule.auditEvent,
    recordMode: isMainnet ? "deployed_mainnet_escrow" : "development_mode_record",
    contractId: isMainnet ? contractId : null,
  };
}
