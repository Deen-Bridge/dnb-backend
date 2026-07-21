import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import { buildPaymentTransaction, validateSignedPaymentXdr, server, networkPassphrase, USDC_ISSUER } from "../src/services/stellar/stellarService.js";

describe("Stellar signed XDR validation", () => {
  beforeEach(() => {
    // Mock Horizon loadAccount to return an account with balances
    jest.spyOn(server, "loadAccount").mockImplementation(async (key) => {
      const acc = new StellarSdk.Account(key || StellarSdk.Keypair.random().publicKey(), "1");
      acc.balances = [
        { asset_type: "native", balance: "10" },
        { asset_code: "USDC", asset_issuer: USDC_ISSUER, balance: "100" },
      ];
      return acc;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("validates a correctly-formed signed XDR", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destKeypair = StellarSdk.Keypair.random();
    const memo = "DNB-TEST-MEMO";

    const payment = await buildPaymentTransaction({
      sourcePublicKey: sourceKeypair.publicKey(),
      destinationPublicKey: destKeypair.publicKey(),
      amount: "5",
      memo,
    });

    const tx = StellarSdk.TransactionBuilder.fromXDR(payment.xdr, networkPassphrase);
    tx.sign(sourceKeypair);
    const signedXdr = tx.toXDR();

    // Expect no throw
    expect(() =>
      validateSignedPaymentXdr(
        signedXdr,
        [{ destination: destKeypair.publicKey(), amount: "5" }],
        memo,
        sourceKeypair.publicKey(),
        true
      )
    ).not.toThrow();
  });

  it("rejects a tampered XDR with wrong amount or destination", async () => {
    const sourceKeypair = StellarSdk.Keypair.random();
    const destKeypair = StellarSdk.Keypair.random();
    const otherDest = StellarSdk.Keypair.random();
    const memo = "DNB-TEST-MEMO";

    const payment = await buildPaymentTransaction({
      sourcePublicKey: sourceKeypair.publicKey(),
      destinationPublicKey: destKeypair.publicKey(),
      amount: "5",
      memo,
    });

    // Create a tampered XDR by building a different transaction (amount 1)
    const tampered = await buildPaymentTransaction({
      sourcePublicKey: sourceKeypair.publicKey(),
      destinationPublicKey: otherDest.publicKey(),
      amount: "1",
      memo,
    });

    const txTampered = StellarSdk.TransactionBuilder.fromXDR(tampered.xdr, networkPassphrase);
    txTampered.sign(sourceKeypair);
    const tamperedXdr = txTampered.toXDR();

    expect(() =>
      validateSignedPaymentXdr(
        tamperedXdr,
        [{ destination: destKeypair.publicKey(), amount: "5" }],
        memo,
        sourceKeypair.publicKey(),
        true
      )
    ).toThrow();
  });
});
