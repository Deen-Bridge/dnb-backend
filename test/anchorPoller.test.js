import { jest } from "@jest/globals";

// The poller resolves the anchor JWT via getStoredAnchorJwt, which is
// backed by Redis. Redis isn't available in this environment/CI, so - as in
// the other JWT-dependent test files - we substitute a fake in-memory cache
// via jest.unstable_mockModule (jest.spyOn cannot mutate a local ESM
// module's live-bound named exports).
const fakeStore = new Map();

jest.unstable_mockModule("../src/utils/cache.js", () => ({
  setCacheExpireAt: jest.fn(async (key, value, timestamp) => {
    fakeStore.set(key, { value, expiresAt: timestamp });
    return true;
  }),
  getCache: jest.fn(async (key) => {
    const entry = fakeStore.get(key);
    if (!entry) return null;
    if (entry.expiresAt * 1000 <= Date.now()) {
      fakeStore.delete(key);
      return null;
    }
    return entry.value;
  }),
  getCacheOrSet: jest.fn(async (key, fallbackFn) => fallbackFn()),
}));

const mongoose = (await import("mongoose")).default;
const axios = (await import("axios")).default;
const StellarSdk = await import("@stellar/stellar-sdk");
const { default: AnchorTransaction } = await import(
  "../src/models/AnchorTransaction.js"
);
const { storeAnchorJwt } = await import("../src/services/stellar/anchorService.js");
const { USDC_ISSUER } = await import("../src/services/stellar/stellarService.js");
const { tick } = await import("../src/jobs/anchorPoller.js");

const HOME_DOMAIN = "testanchor.stellar.org";
const TRANSFER_SERVER = `https://${HOME_DOMAIN}/sep24`;
const WEB_AUTH_ENDPOINT = `https://${HOME_DOMAIN}/auth`;

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await AnchorTransaction.deleteMany({ homeDomain: HOME_DOMAIN });
  await mongoose.disconnect();
});

afterEach(async () => {
  jest.restoreAllMocks();
  fakeStore.clear();
  await AnchorTransaction.deleteMany({ homeDomain: HOME_DOMAIN });
});

const mockAnchorDiscovery = () => {
  process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
  jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
    TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
    WEB_AUTH_ENDPOINT,
    SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
    CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
  });
};

/** getAnchorInfo's /info fetch and the poller's /transaction fetch both go
 * through axios.get, so the mock must dispatch on URL rather than using a
 * single mockResolvedValueOnce (which would only satisfy whichever call
 * happens first).
 */
const mockTransactionStatus = (transaction) => {
  jest.spyOn(axios, "get").mockImplementation((url) => {
    if (url === `${TRANSFER_SERVER}/info`) return Promise.resolve({ data: {} });
    if (url === `${TRANSFER_SERVER}/transaction`) return Promise.resolve({ data: { transaction } });
    return Promise.reject(new Error(`Unexpected axios.get(${url})`));
  });
};

const mockTransactionStatusError = (error) => {
  jest.spyOn(axios, "get").mockImplementation((url) => {
    if (url === `${TRANSFER_SERVER}/info`) return Promise.resolve({ data: {} });
    if (url === `${TRANSFER_SERVER}/transaction`) return Promise.reject(error);
    return Promise.reject(new Error(`Unexpected axios.get(${url})`));
  });
};

const seedRecord = async (overrides = {}) => {
  const userId = new mongoose.Types.ObjectId();
  await storeAnchorJwt(
    userId.toString(),
    HOME_DOMAIN,
    "fake-anchor-jwt",
    Math.floor(Date.now() / 1000) + 3600
  );
  const record = await AnchorTransaction.create({
    user: userId,
    homeDomain: HOME_DOMAIN,
    kind: "deposit",
    anchorTransactionId: `poll-test-${Date.now()}-${Math.random()}`,
    status: "incomplete",
    nextPollAt: new Date(Date.now() - 1000), // already due
    ...overrides,
  });
  return record;
};

describe("Anchor transaction poller", () => {
  it("progresses a record through the SEP-24 lifecycle to a terminal state, storing statuses verbatim", async () => {
    mockAnchorDiscovery();
    const record = await seedRecord();

    mockTransactionStatus({ status: "pending_anchor", amount_in: "100" });
    await tick();
    let updated = await AnchorTransaction.findById(record._id);
    expect(updated.status).toBe("pending_anchor");
    expect(updated.amountIn).toBe("100");
    expect(updated.pollAttempts).toBe(0);

    // Push it due again to simulate the next tick without waiting real time.
    await AnchorTransaction.updateOne({ _id: record._id }, { nextPollAt: new Date(Date.now() - 1000) });
    mockTransactionStatus({
      status: "completed",
      amount_in: "100",
      amount_out: "98",
      amount_fee: "2",
      stellar_transaction_id: "deadbeef",
    });
    await tick();
    updated = await AnchorTransaction.findById(record._id);
    expect(updated.status).toBe("completed");
    expect(updated.stellarTxHash).toBe("deadbeef");
  });

  it("stops touching a record once it reaches a terminal status", async () => {
    mockAnchorDiscovery();
    const record = await seedRecord({ status: "completed" });

    const axiosSpy = jest.spyOn(axios, "get");
    await tick();

    expect(axiosSpy).not.toHaveBeenCalled();
    const unchanged = await AnchorTransaction.findById(record._id);
    expect(unchanged.status).toBe("completed");
  });

  it("backs off and records the error when the anchor call fails, without crashing", async () => {
    mockAnchorDiscovery();
    const record = await seedRecord();
    const before = record.nextPollAt.getTime();

    mockTransactionStatusError(new Error("anchor unreachable"));
    await tick();

    const updated = await AnchorTransaction.findById(record._id);
    expect(updated.status).toBe("incomplete"); // unchanged
    expect(updated.pollAttempts).toBe(1);
    expect(updated.lastError).toContain("anchor unreachable");
    expect(updated.nextPollAt.getTime()).toBeGreaterThan(before);
  });

  it("is a no-op when no record is due", async () => {
    mockAnchorDiscovery();
    await seedRecord({ nextPollAt: new Date(Date.now() + 60000) }); // not due yet

    const axiosSpy = jest.spyOn(axios, "get");
    await tick();

    expect(axiosSpy).not.toHaveBeenCalled();
  });

  it("backs off without an anchor error when no JWT session is stored for the record's user", async () => {
    mockAnchorDiscovery();
    const orphanUserId = new mongoose.Types.ObjectId();
    const record = await AnchorTransaction.create({
      user: orphanUserId,
      homeDomain: HOME_DOMAIN,
      kind: "deposit",
      anchorTransactionId: `poll-orphan-${Date.now()}`,
      status: "incomplete",
      nextPollAt: new Date(Date.now() - 1000),
    });

    const axiosGetSpy = jest.spyOn(axios, "get");
    await tick();

    expect(axiosGetSpy).not.toHaveBeenCalled();
    const updated = await AnchorTransaction.findById(record._id);
    expect(updated.pollAttempts).toBe(1);
    expect(updated.status).toBe("incomplete");
  });
});
