import { jest } from "@jest/globals";

// Interactive-flow endpoints need a "stored anchor JWT" to exist, which
// normally lives in Redis. Redis isn't available in this environment/CI, so
// (as with anchorJwtStorage.test.js) we substitute a fake in-memory cache via
// jest.unstable_mockModule - jest.spyOn cannot mutate a local ESM module's
// live-bound named exports, so this is the only way to make storeAnchorJwt/
// getStoredAnchorJwt actually round-trip in a test.
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

const request = (await import("supertest")).default;
const mongoose = (await import("mongoose")).default;
const axios = (await import("axios")).default;
const StellarSdk = await import("@stellar/stellar-sdk");
const { default: app } = await import("../app.js");
const { default: User } = await import("../src/models/User.js");
const { default: AnchorTransaction } = await import(
  "../src/models/AnchorTransaction.js"
);
const { storeAnchorJwt } = await import(
  "../src/services/stellar/anchorService.js"
);
const { server, USDC_ISSUER } = await import(
  "../src/services/stellar/stellarService.js"
);

const HOME_DOMAIN = "testanchor.stellar.org";
const TRANSFER_SERVER = `https://${HOME_DOMAIN}/sep24`;
const WEB_AUTH_ENDPOINT = `https://${HOME_DOMAIN}/auth`;

const testUser = {
  name: "Interactive Flow Test User",
  email: "anchor_interactive_test@example.com",
  password: "password123",
  role: "student",
};

beforeAll(async () => {
  await mongoose.connect(process.env.MONGO_URI);
});

afterAll(async () => {
  await User.deleteMany({ email: testUser.email });
  await AnchorTransaction.deleteMany({ homeDomain: HOME_DOMAIN });
  await mongoose.disconnect();
});

afterEach(() => {
  jest.restoreAllMocks();
  fakeStore.clear();
});

const makeAccount = (publicKey, { hasTrustline }) => {
  const account = new StellarSdk.Account(publicKey, "1000");
  account.balances = [
    { asset_type: "native", balance: "100" },
    ...(hasTrustline
      ? [
          {
            asset_type: "credit_alphanum4",
            asset_code: "USDC",
            asset_issuer: USDC_ISSUER,
            balance: "50",
          },
        ]
      : []),
  ];
  return account;
};

const mockAnchorDiscovery = () => {
  jest.spyOn(StellarSdk.StellarToml.Resolver, "resolve").mockResolvedValue({
    TRANSFER_SERVER_SEP0024: TRANSFER_SERVER,
    WEB_AUTH_ENDPOINT,
    SIGNING_KEY: StellarSdk.Keypair.random().publicKey(),
    CURRENCIES: [{ code: "USDC", issuer: USDC_ISSUER }],
  });
  jest.spyOn(axios, "get").mockResolvedValue({ data: {} });
};

const setupUserWithSession = async () => {
  process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
  await User.deleteMany({ email: testUser.email });
  const registerRes = await request(app).post("/api/auth/register").send(testUser);
  const publicKey = StellarSdk.Keypair.random().publicKey();
  await User.findByIdAndUpdate(registerRes.body.user.id, {
    stellarWallet: { publicKey, connectedAt: new Date(), network: "testnet" },
  });
  await storeAnchorJwt(
    registerRes.body.user.id,
    HOME_DOMAIN,
    "fake-anchor-jwt",
    Math.floor(Date.now() / 1000) + 3600
  );
  return { accessToken: registerRes.body.accessToken, userId: registerRes.body.user.id, publicKey };
};

describe("Anchor interactive deposit/withdrawal flows", () => {
  it("returns 401 with requiresReauth when no anchor session is stored", async () => {
    process.env.ANCHOR_HOME_DOMAINS = HOME_DOMAIN;
    await User.deleteMany({ email: testUser.email });
    const registerRes = await request(app).post("/api/auth/register").send(testUser);
    await User.findByIdAndUpdate(registerRes.body.user.id, {
      stellarWallet: {
        publicKey: StellarSdk.Keypair.random().publicKey(),
        connectedAt: new Date(),
        network: "testnet",
      },
    });

    const res = await request(app)
      .post("/api/stellar/anchor/deposits")
      .set("Authorization", `Bearer ${registerRes.body.accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(401);
    expect(res.body.requiresReauth).toBe(true);
  });

  it("starts a deposit and includes an unsigned trustline XDR when the account has no USDC trustline", async () => {
    const { accessToken, publicKey } = await setupUserWithSession();
    mockAnchorDiscovery();
    jest
      .spyOn(server, "loadAccount")
      .mockImplementation(async (key) => makeAccount(key, { hasTrustline: false }));
    jest.spyOn(axios, "post").mockResolvedValue({
      data: { type: "interactive_customer_info_needed", url: "https://anchor/interactive/abc", id: "anchor-tx-1" },
    });

    const res = await request(app)
      .post("/api/stellar/anchor/deposits")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.deposit.url).toBe("https://anchor/interactive/abc");
    expect(res.body.data.deposit.id).toBe("anchor-tx-1");
    expect(typeof res.body.data.deposit.trustlineXdr).toBe("string");

    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      res.body.data.deposit.trustlineXdr,
      StellarSdk.Networks.TESTNET
    );
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].type).toBe("changeTrust");
    expect(parsed.operations[0].line.code).toBe("USDC");
    expect(parsed.operations[0].line.issuer).toBe(USDC_ISSUER);

    const persisted = await AnchorTransaction.findOne({ anchorTransactionId: "anchor-tx-1" });
    expect(persisted).not.toBeNull();
    expect(persisted.kind).toBe("deposit");
    expect(persisted.status).toBe("incomplete");
  });

  it("starts a deposit without a trustline XDR when the account already has a USDC trustline", async () => {
    const { accessToken } = await setupUserWithSession();
    mockAnchorDiscovery();
    jest
      .spyOn(server, "loadAccount")
      .mockImplementation(async (key) => makeAccount(key, { hasTrustline: true }));
    jest.spyOn(axios, "post").mockResolvedValue({
      data: { type: "interactive_customer_info_needed", url: "https://anchor/interactive/def", id: "anchor-tx-2" },
    });

    const res = await request(app)
      .post("/api/stellar/anchor/deposits")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.deposit.trustlineXdr).toBeUndefined();
  });

  it("still returns the deposit url/id when trustline building throws after the deposit is created at the anchor", async () => {
    const { accessToken } = await setupUserWithSession();
    mockAnchorDiscovery();
    jest
      .spyOn(server, "loadAccount")
      .mockRejectedValue(new Error("horizon unreachable"));
    jest.spyOn(axios, "post").mockResolvedValue({
      data: {
        type: "interactive_customer_info_needed",
        url: "https://anchor/interactive/jkl",
        id: "anchor-tx-4",
      },
    });

    const res = await request(app)
      .post("/api/stellar/anchor/deposits")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.deposit.url).toBe("https://anchor/interactive/jkl");
    expect(res.body.data.deposit.id).toBe("anchor-tx-4");
    expect(res.body.data.deposit.trustlineXdr).toBeUndefined();

    const persisted = await AnchorTransaction.findOne({ anchorTransactionId: "anchor-tx-4" });
    expect(persisted).not.toBeNull();
    expect(persisted.status).toBe("incomplete");
  });

  it("starts a withdrawal and never includes a trustline XDR", async () => {
    const { accessToken } = await setupUserWithSession();
    mockAnchorDiscovery();
    jest
      .spyOn(server, "loadAccount")
      .mockImplementation(async (key) => makeAccount(key, { hasTrustline: false }));
    jest.spyOn(axios, "post").mockResolvedValue({
      data: { type: "interactive_customer_info_needed", url: "https://anchor/interactive/ghi", id: "anchor-tx-3" },
    });

    const res = await request(app)
      .post("/api/stellar/anchor/withdrawals")
      .set("Authorization", `Bearer ${accessToken}`)
      .send({ homeDomain: HOME_DOMAIN });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.withdrawal.url).toBe("https://anchor/interactive/ghi");
    expect(res.body.data.withdrawal.trustlineXdr).toBeUndefined();

    const persisted = await AnchorTransaction.findOne({ anchorTransactionId: "anchor-tx-3" });
    expect(persisted.kind).toBe("withdrawal");
  });
});
