import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  buildAddSignerXdr,
  buildRemoveSignerXdr,
  buildThresholdsXdr,
  createPendingTransaction,
  addSignatures,
  submitPending,
} from "../src/services/stellar/multisigService.js";

const PASS = StellarSdk.Networks.TESTNET;
const master = StellarSdk.Keypair.random();
const s1 = StellarSdk.Keypair.random();
const s2 = StellarSdk.Keypair.random();
const outsider = StellarSdk.Keypair.random();

const accountDetails = {
  sequence: "100",
  signers: [
    { key: s1.publicKey(), weight: 1 },
    { key: s2.publicKey(), weight: 1 },
    { key: master.publicKey(), weight: 0 },
  ],
  thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 2 },
};

const makeDeps = (extra = {}) => ({
  networkPassphrase: PASS,
  loadAccount: jest.fn(async () => accountDetails),
  loadAccountDetails: jest.fn(async () => accountDetails),
  submit: jest.fn(async () => ({ hash: "abc", ledger: 7 })),
  model: { create: jest.fn(async (doc) => ({ ...doc, save: jest.fn() })) },
  ...extra,
});

const sign = (xdr, kp) => {
  const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, PASS);
  tx.sign(kp);
  return tx.toXDR();
};

describe("multisigService", () => {
  it("builds unsigned setOptions XDR for add/remove signer and thresholds", async () => {
    const deps = makeDeps();
    const add = await buildAddSignerXdr({
      accountId: master.publicKey(), signerPublicKey: s1.publicKey(), weight: 2, deps,
    });
    let tx = StellarSdk.TransactionBuilder.fromXDR(add.xdr, PASS);
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations[0].signer.weight).toBe(2);

    const rem = await buildRemoveSignerXdr({
      accountId: master.publicKey(), signerPublicKey: s1.publicKey(), deps,
    });
    tx = StellarSdk.TransactionBuilder.fromXDR(rem.xdr, PASS);
    expect(tx.operations[0].signer.weight).toBe(0);

    const th = await buildThresholdsXdr({
      accountId: master.publicKey(), lowThreshold: 1, medThreshold: 2, highThreshold: 3, deps,
    });
    tx = StellarSdk.TransactionBuilder.fromXDR(th.xdr, PASS);
    expect(tx.operations[0].highThreshold).toBe(3);
  });

  it("rejects invalid input", async () => {
    const deps = makeDeps();
    await expect(
      buildAddSignerXdr({ accountId: master.publicKey(), signerPublicKey: "bad", weight: 1, deps })
    ).rejects.toThrow("Invalid signer public key");
    await expect(
      buildThresholdsXdr({ accountId: master.publicKey(), deps })
    ).rejects.toThrow("At least one");
  });

  it("collects signatures and submits only when the threshold is met", async () => {
    const deps = makeDeps();
    const { xdr } = await buildAddSignerXdr({
      accountId: master.publicKey(), signerPublicKey: outsider.publicKey(), weight: 1, deps,
    });
    const pending = await createPendingTransaction({
      accountId: master.publicKey(), xdr, createdBy: "u1", deps,
    });
    expect(pending.threshold).toBe(2); // signer change => high threshold
    pending.save = jest.fn();

    await expect(submitPending({ pending, deps })).rejects.toThrow("threshold not met");

    // outsider is not in the signer set -> rejected
    await expect(
      addSignatures({ pending, signedXdr: sign(xdr, outsider), deps })
    ).rejects.toThrow("No new valid");

    let r = await addSignatures({ pending, signedXdr: sign(xdr, s1), deps });
    expect(r.totalWeight).toBe(1);
    expect(pending.status).toBe("pending");

    // repeat signature adds nothing
    await expect(
      addSignatures({ pending, signedXdr: sign(xdr, s1), deps })
    ).rejects.toThrow("No new valid");

    r = await addSignatures({ pending, signedXdr: sign(xdr, s2), deps });
    expect(r.totalWeight).toBe(2);
    expect(pending.status).toBe("ready");

    const result = await submitPending({ pending, deps });
    expect(result.hash).toBe("abc");
    expect(pending.status).toBe("submitted");
    const submitted = StellarSdk.TransactionBuilder.fromXDR(deps.submit.mock.calls[0][0], PASS);
    expect(submitted.signatures).toHaveLength(2);
    await expect(submitPending({ pending, deps })).rejects.toThrow("already submitted");
  });

  it("rejects a signed XDR for a different transaction", async () => {
    const deps = makeDeps();
    const a = await buildAddSignerXdr({
      accountId: master.publicKey(), signerPublicKey: s1.publicKey(), weight: 1, deps,
    });
    const b = await buildRemoveSignerXdr({
      accountId: master.publicKey(), signerPublicKey: s2.publicKey(), deps,
    });
    const pending = await createPendingTransaction({
      accountId: master.publicKey(), xdr: a.xdr, createdBy: "u1", deps,
    });
    pending.save = jest.fn();
    await expect(
      addSignatures({ pending, signedXdr: sign(b.xdr, s1), deps })
    ).rejects.toThrow("does not match");
  });
});
