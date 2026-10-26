import { describe, test, expect } from "@jest/globals";
import {
  ESCROW_STATES,
  transitionEscrowState,
} from "../src/services/scholarshipEscrowStateMachine.js";

describe("Scholarship escrow milestone states and transitions (#478)", () => {
  test("allows valid actor transitions and distinguishes mainnet vs development mode", () => {
    const funded = transitionEscrowState({
      currentState: ESCROW_STATES.DRAFT,
      targetState: ESCROW_STATES.FUNDED,
      actorRole: "donor",
      environment: "mainnet",
      contractId: "C" + "A".repeat(55),
    });
    expect(funded.state).toBe("funded");
    expect(funded.recordMode).toBe("deployed_mainnet_escrow");

    const devPending = transitionEscrowState({
      currentState: ESCROW_STATES.FUNDED,
      targetState: ESCROW_STATES.MILESTONE_PENDING,
      actorRole: "beneficiary",
      environment: "development",
    });
    expect(devPending.recordMode).toBe("development_mode_record");
  });

  test("rejects invalid transitions and unauthorized actors", () => {
    expect(() =>
      transitionEscrowState({
        currentState: ESCROW_STATES.DRAFT,
        targetState: ESCROW_STATES.RELEASED,
        actorRole: "donor",
      })
    ).toThrow(/Invalid escrow state transition/);

    expect(() =>
      transitionEscrowState({
        currentState: ESCROW_STATES.MILESTONE_PENDING,
        targetState: ESCROW_STATES.APPROVED,
        actorRole: "beneficiary",
      })
    ).toThrow(/not authorized/);
  });
});
