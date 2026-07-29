import { jest } from "@jest/globals";
import crypto from "node:crypto";
import axios from "axios";
import * as StellarSdk from "@stellar/stellar-sdk";
import { fetchAndValidateChallenge } from "../src/services/stellar/anchorService.js";
import { networkPassphrase } from "../src/services/stellar/stellarService.js";
import { USDC_ISSUER } from "../src/services/stellar/stellarService.js";

const HOME_DOMAIN = "testanchor.stellar.org";
const TRANSFER_SERVER = `https://${HOME_DOMAIN}/sep24`;
const WEB_AUTH_ENDPOINT = `https://${HOME_DOMAIN}/auth`;
const WEB_AUTH_DOMAIN = HOME_DOMAIN;

const serverKeypair = StellarSdk.Keypair.random();
const impostorKeypair = StellarSdk.Keypair.random();
const clientKeypair = StellarSdk.Keypair.random();

const mockToml = (overrides = {}) => ({
  TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
  WEB_AUTH_ENDPOINT,
  SIGNING_KEY: serverKeypair.publicKey(),
  CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
  ...overrides,
});

const mockChallengeResponse = (xdr) => (url) => {
  if (url === WEB_AUTH_ENDPOINT) return Promise.resolve({ data: { transaction: xdr } });
  if (url === `${TRANSFER_SERVER}/info`) return Promise.resolve({ data: {} });
  return Promise.reject(new Error(`Unexpected axios.get(${url})`));
};

const setupMocks = ({ toml = mockToml(), challengeXdr } = {}) => {
  jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue(toml);
  jest.spyOn(axios, "get").mockImplementation(mockChallengeResponse(challengeXdr));
};

/** Builds a raw SEP-10 style challenge without relying on buildChallengeTx's defaults, so tests can violate one rule at a time. */
const buildRawChallenge = ({
  sourceKeypair = serverKeypair,
  signWith = sourceKeypair,
  sourceSequence = "-1",
  homeDomain = HOME_DOMAIN,
  webAuthDomain = WEB_AUTH_DOMAIN,
  passphrase = networkPassphrase,
  clientAccountId = clientKeypair.publicKey(),
  timeout = 300,
} = {}) => {
  const account = new StellarSdk.Account(sourceKeypair.publicKey(), sourceSequence);
  const now = Math.floor(Date.now() / 1000);
  const randomValue = crypto.randomBytes(48).toString("base64");

  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: passphrase,
    timebounds: { minTime: now, maxTime: now + timeout },
  })
    .addOperation(
      StellarSdk.Operation.manageData({
        name: `${homeDomain} auth`,
        value: randomValue,
        source: clientAccountId,
      })
    )
    .addOperation(
      StellarSdk.Operation.manageData({
        name: "web_auth_domain",
        value: webAuthDomain,
        source: sourceKeypair.publicKey(),
      })
    );

  const tx = builder.build();
  tx.sign(signWith);
  return tx.toEnvelope().toXDR("base64").toString();
};

describe("fetchAndValidateChallenge - rejection matrix", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.ANCHOR_HOME_DOMAINS;
  });

  beforeEach(() => {
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
  });

  it("rejects a challenge with a non-zero sequence number", async () => {
    const xdr = buildRawChallenge({ sourceSequence: "0" }); // builds to sequence 1
    setupMocks({ challengeXdr: xdr });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("sequence number should be zero"),
    });
  });

  it("rejects a challenge not signed by the TOML's SIGNING_KEY", async () => {
    // Source account matches the declared SIGNING_KEY (so the source-account
    // check passes), but the envelope is actually signed by an impostor -
    // isolates the signature check itself.
    const xdr = buildRawChallenge({ sourceKeypair: serverKeypair, signWith: impostorKeypair });
    setupMocks({ challengeXdr: xdr });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("not signed by server"),
    });
  });

  it("rejects a challenge built for the wrong network passphrase", async () => {
    // Signed correctly by the server keypair, but for a different network -
    // the signature is network-scoped so it fails verification against ours.
    const xdr = buildRawChallenge({ passphrase: StellarSdk.Networks.PUBLIC });
    setupMocks({ challengeXdr: xdr });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("not signed by server"),
    });
  });

  it("rejects a challenge whose manage_data operation names the wrong home domain", async () => {
    const xdr = buildRawChallenge({ homeDomain: "attacker-domain.example.com" });
    setupMocks({ challengeXdr: xdr });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("does not match the expected home domain"),
    });
  });

  it("rejects a challenge issued for a different account than requested", async () => {
    const someoneElse = StellarSdk.Keypair.random();
    const xdr = buildRawChallenge({ clientAccountId: someoneElse.publicKey() });
    setupMocks({ challengeXdr: xdr });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("different account"),
    });
  });

  it("rejects when the anchor returns no transaction field at all", async () => {
    setupMocks({ challengeXdr: undefined });
    jest.spyOn(axios, "get").mockImplementation((url) => {
      if (url === WEB_AUTH_ENDPOINT) return Promise.resolve({ data: {} });
      if (url === `${TRANSFER_SERVER}/info`) return Promise.resolve({ data: {} });
      return Promise.reject(new Error(`Unexpected axios.get(${url})`));
    });

    await expect(
      fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() })
    ).rejects.toMatchObject({
      statusCode: 502,
      message: expect.stringContaining("did not return a challenge transaction"),
    });
  });

  it("never returns a challenge to the caller on any rejection path", async () => {
    const xdr = buildRawChallenge({ homeDomain: "attacker-domain.example.com" });
    setupMocks({ challengeXdr: xdr });

    let caught;
    try {
      await fetchAndValidateChallenge({ homeDomain: HOME_DOMAIN, account: clientKeypair.publicKey() });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeDefined();
    expect(caught.challengeXdr).toBeUndefined();
  });

  it("accepts a fully valid challenge and returns it for client-side signing", async () => {
    const xdr = buildRawChallenge();
    setupMocks({ challengeXdr: xdr });

    const result = await fetchAndValidateChallenge({
      homeDomain: HOME_DOMAIN,
      account: clientKeypair.publicKey(),
    });

    expect(result.challengeXdr).toBe(xdr);
    expect(result.networkPassphrase).toBe(networkPassphrase);
    expect(result.homeDomain).toBe(HOME_DOMAIN);
  });
});
