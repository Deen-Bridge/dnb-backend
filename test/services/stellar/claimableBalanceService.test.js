import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  buildCreateClaimableBalanceTx,
  buildClaimTx,
} from "../../../src/services/stellar/claimableBalanceService.js";
import { server, USDC, USDC_ISSUER, networkPassphrase } from "../../../src/services/stellar/stellarService.js";
import * as stellarServiceModule from "../../../src/services/stellar/stellarService.js";

const sourceKeypair = StellarSdk.Keypair.random();
const recipientKeypair = StellarSdk.Keypair.random();

describe("Claimable Balance Service", () => {
  beforeEach(() => {
    // Mock Horizon loadAccount
    jest.spyOn(server, "loadAccount").mockImplementation(async (publicKey) => {
      return new StellarSdk.Account(publicKey, "12345");
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("buildCreateClaimableBalanceTx", () => {
    it("builds correct XDR with two claimants and correct predicates", async () => {
      const expiresAt = new Date(Date.now() + 86400000); // 1 day from now
      const expiresTimestamp = Math.floor(expiresAt.getTime() / 1000);

      const result = await buildCreateClaimableBalanceTx({
        sourcePublicKey: sourceKeypair.publicKey(),
        claimantPublicKey: recipientKeypair.publicKey(),
        amount: "50.00",
        expiresAt,
      });

      expect(result.xdr).toBeDefined();
      expect(result.hash).toBeDefined();

      const tx = StellarSdk.TransactionBuilder.fromXDR(result.xdr, networkPassphrase);

      expect(tx.operations.length).toBe(1);
      const op = tx.operations[0];
      
      expect(op.type).toBe("createClaimableBalance");
      expect(op.amount).toBe("50.0000000"); // 7 decimals representation typically
      expect(op.asset.code).toBe("USDC");
      expect(op.asset.issuer).toBe(USDC_ISSUER);
      
      expect(op.claimants.length).toBe(2);

      // Verify recipient claimant
      const recipientClaimant = op.claimants[0];
      expect(recipientClaimant.destination).toBe(recipientKeypair.publicKey());
      expect(recipientClaimant.predicate.switch().name).toBe("claimPredicateBeforeAbsoluteTime");
      expect(recipientClaimant.predicate.value().toString()).toBe(expiresTimestamp.toString());

      // Verify sender claimant
      const senderClaimant = op.claimants[1];
      expect(senderClaimant.destination).toBe(sourceKeypair.publicKey());
      expect(senderClaimant.predicate.switch().name).toBe("claimPredicateNot");
      
      const notPredicate = senderClaimant.predicate.value();
      expect(notPredicate.switch().name).toBe("claimPredicateBeforeAbsoluteTime");
      expect(notPredicate.value().toString()).toBe(expiresTimestamp.toString());
    });
  });

  describe("buildClaimTx", () => {
    const validBalanceId = "00000000" + "0".repeat(64); // 72 chars total hex

    it("adds changeTrust if claimant has no trustline", async () => {
      jest.spyOn(server, "loadAccount").mockImplementation(async (publicKey) => {
        const acc = new StellarSdk.Account(publicKey, "12345");
        acc.balances = [
          { asset_type: "native", balance: "10" }
        ];
        return acc;
      });

      const result = await buildClaimTx({
        claimantPublicKey: recipientKeypair.publicKey(),
        balanceId: validBalanceId,
      });

      const tx = StellarSdk.TransactionBuilder.fromXDR(result.xdr, networkPassphrase);

      expect(tx.operations.length).toBe(2);
      expect(tx.operations[0].type).toBe("changeTrust");
      expect(tx.operations[0].line.code).toBe("USDC");
      
      expect(tx.operations[1].type).toBe("claimClaimableBalance");
      expect(tx.operations[1].balanceId).toBe(validBalanceId);
    });

    it("only claims if claimant already has trustline", async () => {
      jest.spyOn(server, "loadAccount").mockImplementation(async (publicKey) => {
        const acc = new StellarSdk.Account(publicKey, "12345");
        acc.balances = [
          { asset_type: "native", balance: "10" },
          { asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "100" }
        ];
        return acc;
      });

      const result = await buildClaimTx({
        claimantPublicKey: recipientKeypair.publicKey(),
        balanceId: validBalanceId,
      });

      const tx = StellarSdk.TransactionBuilder.fromXDR(result.xdr, networkPassphrase);

      expect(tx.operations.length).toBe(1);
      expect(tx.operations[0].type).toBe("claimClaimableBalance");
      expect(tx.operations[0].balanceId).toBe(validBalanceId);
    });
  });
});
