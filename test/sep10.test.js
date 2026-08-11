// test/sep10.test.js — SEP-10 "Sign in with Stellar" service.
//
// Covers challenge shape, the full happy path (build → sign with a test Keypair
// → verify), every rejection case, and single-use replay protection. Horizon is
// mocked so signature verification never needs a live network call.
import { jest } from "@jest/globals";
import {
  Keypair,
  Networks,
  Transaction,
} from "@stellar/stellar-sdk";

const HOME_DOMAIN = "deenbridge.app";
const WEB_AUTH_DOMAIN = "api.deenbridge.app";
const NETWORK_PASSPHRASE = Networks.TESTNET;

// A dedicated server signing keypair for the test run.
const serverKeypair = Keypair.random();

// Configure the feature BEFORE the service module is imported (module reads env
// at load time). Then dynamic-import so it picks these up.
process.env.SEP10_SIGNING_SECRET = serverKeypair.secret();
process.env.SEP10_HOME_DOMAIN = HOME_DOMAIN;
process.env.SEP10_WEB_AUTH_DOMAIN = WEB_AUTH_DOMAIN;
process.env.SEP10_CHALLENGE_TIMEOUT = "300";

// Mock the Stellar service so verifyChallenge never hits Horizon: loadAccount
// rejects, which routes verification down the master-key (account-not-on-chain)
// SEP-10 path — valid per spec and network-free.
const registerStellarMock = () =>
  jest.unstable_mockModule(
    "../src/services/stellar/stellarService.js",
    () => ({
      server: {
        loadAccount: jest.fn(async () => {
          const err = new Error("Not Found");
          err.response = { status: 404 };
          throw err;
        }),
      },
      networkPassphrase: NETWORK_PASSPHRASE,
      isValidPublicKey: (pk) =>
        typeof pk === "string" && /^G[A-Z0-9]{55}$/.test(pk),
    })
  );

registerStellarMock();
const sep10 = await import("../src/services/stellar/sep10Service.js");

// Sign a challenge XDR with the given keypair(s), returning signed base64 XDR.
const signChallenge = (transactionXdr, ...signers) => {
  const tx = new Transaction(transactionXdr, NETWORK_PASSPHRASE);
  signers.forEach((kp) => tx.sign(kp));
  return tx.toXDR();
};

beforeEach(() => {
  sep10._clearConsumedChallenges();
});

describe("SEP-10 configuration gate", () => {
  it("reports configured when secret + domains are set", () => {
    expect(sep10.isSep10Configured()).toBe(true);
    expect(sep10.getSigningPublicKey()).toBe(serverKeypair.publicKey());
  });
});

describe("buildChallenge", () => {
  it("returns a base64 challenge with sequence 0, signed by the server key", () => {
    const client = Keypair.random();
    const { transaction, network_passphrase } = sep10.buildChallenge(
      client.publicKey()
    );

    expect(typeof transaction).toBe("string");
    expect(network_passphrase).toBe(NETWORK_PASSPHRASE);

    const tx = new Transaction(transaction, NETWORK_PASSPHRASE);
    // SEP-10 challenges are built on the server account with sequence 0.
    expect(tx.source).toBe(serverKeypair.publicKey());
    expect(tx.sequence).toBe("0");
    // Server signature is present.
    expect(tx.signatures.length).toBeGreaterThanOrEqual(1);
  });

  it("rejects a missing or malformed account with INVALID_ACCOUNT", () => {
    expect(() => sep10.buildChallenge(undefined)).toThrow(/valid Stellar/i);
    expect(() => sep10.buildChallenge("not-a-key")).toMatchObject;
    try {
      sep10.buildChallenge("GINVALID");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.code).toBe("INVALID_ACCOUNT");
    }
  });
});

describe("verifyChallenge", () => {
  it("verifies a correctly signed challenge and returns the client account", async () => {
    const client = Keypair.random();
    const { transaction } = sep10.buildChallenge(client.publicKey());
    const signed = signChallenge(transaction, client);

    const proven = await sep10.verifyChallenge(signed);
    expect(proven).toBe(client.publicKey());
  });

  it("rejects an unsigned challenge (client signature missing)", async () => {
    const client = Keypair.random();
    const { transaction } = sep10.buildChallenge(client.publicKey());
    // Not signed by the client at all.
    await expect(sep10.verifyChallenge(transaction)).rejects.toMatchObject({
      code: "INVALID_CHALLENGE",
    });
  });

  it("rejects a challenge signed by the wrong key", async () => {
    const client = Keypair.random();
    const attacker = Keypair.random();
    const { transaction } = sep10.buildChallenge(client.publicKey());
    const signed = signChallenge(transaction, attacker);

    await expect(sep10.verifyChallenge(signed)).rejects.toMatchObject({
      code: "INVALID_CHALLENGE",
    });
  });

  it("rejects a tampered/garbage transaction", async () => {
    await expect(sep10.verifyChallenge("not-valid-xdr")).rejects.toMatchObject({
      code: "INVALID_CHALLENGE",
    });
  });

  it("rejects a replayed challenge (single-use)", async () => {
    const client = Keypair.random();
    const { transaction } = sep10.buildChallenge(client.publicKey());
    const signed = signChallenge(transaction, client);

    const proven = await sep10.verifyChallenge(signed);
    expect(proven).toBe(client.publicKey());

    await expect(sep10.verifyChallenge(signed)).rejects.toMatchObject({
      code: "CHALLENGE_REPLAYED",
    });
  });
});

describe("SEP-10 unconfigured", () => {
  it("returns not-configured and throws when the signing secret is unset", async () => {
    const saved = process.env.SEP10_SIGNING_SECRET;
    delete process.env.SEP10_SIGNING_SECRET;
    jest.resetModules();
    registerStellarMock();
    const fresh = await import("../src/services/stellar/sep10Service.js");

    expect(fresh.isSep10Configured()).toBe(false);
    try {
      fresh.buildChallenge(Keypair.random().publicKey());
      throw new Error("should have thrown");
    } catch (err) {
      expect(err.code).toBe("SEP10_NOT_CONFIGURED");
    }
    await expect(fresh.verifyChallenge("x")).rejects.toMatchObject({
      code: "SEP10_NOT_CONFIGURED",
    });

    process.env.SEP10_SIGNING_SECRET = saved;
  });
});
