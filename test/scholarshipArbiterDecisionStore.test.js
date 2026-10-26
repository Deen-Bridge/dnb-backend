import { describe, test, expect } from "@jest/globals";
import { ScholarshipArbiterDecisionStore } from "../src/services/scholarshipArbiterDecisionStore.js";

describe("Auditable arbiter decision store for scholarship milestones (#479)", () => {
  test("enforces arbiter authorization, hashes private evidence URLs, and keeps append-only trail", () => {
    const store = new ScholarshipArbiterDecisionStore({
      configuredArbiterId: "arbiter_G123",
    });

    const first = store.recordDecision({
      actorId: "arbiter_G123",
      milestoneId: "ms_1",
      decision: "approved",
      reasonCode: "TRANSCRIPT_VERIFIED",
      evidenceUrl: "https://private-bucket.internal/student-transcript.pdf?token=secret",
      txOrEventHash: "e".repeat(64),
    });

    expect(first.evidenceReference).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(JSON.stringify(first)).not.toContain("private-bucket.internal");

    store.recordDecision({
      actorId: "arbiter_G123",
      milestoneId: "ms_1",
      decision: "correction",
      reasonCode: "UPDATED_EVENT_HASH",
      evidenceUrl: null,
      txOrEventHash: "f".repeat(64),
      correctsDecisionId: first.decisionId,
    });

    expect(store.getMilestoneHistory("ms_1")).toHaveLength(2);

    expect(() =>
      store.recordDecision({
        actorId: "intruder_99",
        milestoneId: "ms_1",
        decision: "approved",
        reasonCode: "FORGED",
        txOrEventHash: "a".repeat(64),
      })
    ).toThrow(/Unauthorized actor/);
  });
});
