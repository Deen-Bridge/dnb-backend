import { describe, test, expect } from "@jest/globals";
import { StellarPaymentVerifier } from "../src/services/stellarPaymentTransferVerifier.js";

const DEST = "G" + "A".repeat(55);
const ISSUER = "G" + "B".repeat(55);

describe("Verify Stellar transaction success and destination before completing payment (#477)", () => {
  test("completes verified transfer and handles idempotent replay vs duplicate reuse", () => {
    const verifier = new StellarPaymentVerifier();
    const txRecord = {
      hash: "a".repeat(64),
      successful: true,
      ledger: 91000,
      memo: "intent-101",
      operations: [
        {
          type: "payment",
          to: DEST,
          asset_code: "USDC",
          asset_issuer: ISSUER,
          amount: "50.0000000",
        },
      ],
    };

    const first = verifier.verifyAndCompletePayment({
      intentId: "intent-101",
      expectedDestination: DEST,
      expectedAssetCode: "USDC",
      expectedAssetIssuer: ISSUER,
      expectedAmount: "50.0000000",
      expectedMemo: "intent-101",
      txRecord,
    });
    expect(first.status).toBe("completed");
    expect(first.idempotentReplay).toBe(false);

    const replay = verifier.verifyAndCompletePayment({
      intentId: "intent-101",
      expectedDestination: DEST,
      expectedAssetCode: "USDC",
      expectedAssetIssuer: ISSUER,
      expectedAmount: "50.0000000",
      expectedMemo: "intent-101",
      txRecord,
    });
    expect(replay.status).toBe("completed");
    expect(replay.idempotentReplay).toBe(true);

    const hijacked = verifier.verifyAndCompletePayment({
      intentId: "intent-999",
      expectedDestination: DEST,
      expectedAssetCode: "USDC",
      expectedAssetIssuer: ISSUER,
      expectedAmount: "50.0000000",
      expectedMemo: "intent-101",
      txRecord,
    });
    expect(hijacked.status).toBe("rejected");
    expect(hijacked.reason).toBe("DUPLICATE_TRANSACTION_HASH");
  });

  test("rejects failed tx, wrong destination, or wrong asset", () => {
    const verifier = new StellarPaymentVerifier();
    const failed = verifier.verifyAndCompletePayment({
      intentId: "intent-2",
      expectedDestination: DEST,
      expectedAssetCode: "USDC",
      expectedAssetIssuer: ISSUER,
      expectedAmount: "10",
      txRecord: { hash: "b".repeat(64), successful: false, ledger: 10 },
    });
    expect(failed.reason).toBe("TRANSACTION_NOT_SUCCESSFUL");
  });
});
