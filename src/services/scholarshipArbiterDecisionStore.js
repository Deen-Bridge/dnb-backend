/**
 * Append-only auditable arbiter decision log for scholarship milestones (#479).
 */

import crypto from "node:crypto";

export class ScholarshipArbiterDecisionStore {
  constructor({ configuredArbiterId }) {
    if (!configuredArbiterId) {
      throw new Error("configuredArbiterId is required");
    }
    this.configuredArbiterId = configuredArbiterId;
    this._records = [];
  }

  recordDecision({
    actorId,
    milestoneId,
    decision, // "approved", "rejected", "disputed", "correction"
    reasonCode,
    evidenceUrl,
    txOrEventHash,
    correctsDecisionId = null,
    decidedAt = new Date().toISOString(),
  }) {
    if (actorId !== this.configuredArbiterId) {
      throw new Error("Unauthorized actor: only the configured arbiter may record milestone decisions");
    }
    if (!milestoneId || !decision || !reasonCode || !txOrEventHash) {
      throw new Error("milestoneId, decision, reasonCode, and txOrEventHash are required");
    }
    const evidenceDigest = evidenceUrl
      ? `sha256:${crypto.createHash("sha256").update(String(evidenceUrl)).digest("hex")}`
      : null;

    const entry = Object.freeze({
      decisionId: `dec_${this._records.length + 1}`,
      arbiterId: actorId,
      milestoneId,
      decision,
      reasonCode,
      evidenceReference: evidenceDigest,
      txOrEventHash,
      correctsDecisionId,
      decidedAt,
    });
    this._records.push(entry);
    return entry;
  }

  getMilestoneHistory(milestoneId) {
    return this._records.filter((r) => r.milestoneId === milestoneId);
  }
}
