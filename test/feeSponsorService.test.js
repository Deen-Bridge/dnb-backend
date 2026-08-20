// Fee-bump sponsorship service (#30) — structural whitelist, fee-bump fee
// correctness, spend caps, and secret handling. Uses the REAL @stellar/stellar-sdk
// (no live network) so the whitelist and fee math are exercised end-to-end.
import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// A dedicated sponsor account for the whole suite. Set before importing the
// service so getFeeSponsorKeypair() can read it.
const SPONSOR = StellarSdk.Keypair.random();
process.env.STELLAR_NETWORK = "testnet";
process.env.FEE_SPONSOR_ENABLED = "true";
process.env.FEE_SPONSOR_SECRET = SPONSOR.secret();

const {
  validateInnerTransaction,
  buildExpectedOperations,
  computeFeeBumpFee,
  wrapWithFeeBump,
  prepareSponsoredSubmission,
  checkSpendCaps,
  recordSponsorshipSpend,
  getFeeSponsorKeypair,
  getFeeSponsorPublicKey,
  getFeeSponsorConfig,
  validateFeeSponsorBootConfig,
  SponsorshipError,
  utcDay,
} = await import("../src/services/stellar/feeSponsorService.js");
const { networkPassphrase, toStroops } = await import(
  "../src/services/stellar/stellarService.js"
);
const SponsorshipSpend = (await import("../src/models/SponsorshipSpend.js"))
  .default;

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC = new StellarSdk.Asset("USDC", USDC_ISSUER);

// A single Mongo connection for the whole suite (caps + orchestration tests
// touch SponsorshipSpend). Mirrors the fallback pattern used by other DB tests:
// prefer the CI-provided MONGO_URI, otherwise spin an in-memory server.
let mongoServer;
beforeAll(async () => {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  if (process.env.MONGO_URI) {
    try {
      await mongoose.connect(`${process.env.MONGO_URI}_feesponsor`, {
        serverSelectionTimeoutMS: 2000,
      });
      return;
    } catch {
      /* fall back to in-memory */
    }
  }
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  if (mongoServer) await mongoServer.stop();
});

const BUYER = StellarSdk.Keypair.random();
const CREATOR = StellarSdk.Keypair.random();
const PLATFORM = StellarSdk.Keypair.random();
const OTHER = StellarSdk.Keypair.random();
const MEMO = "DNB-BOOK-abcd1234";

const directRow = {
  buyerWallet: BUYER.publicKey(),
  creatorWallet: CREATOR.publicKey(),
  amount: "15",
  currency: "USDC",
  memo: MEMO,
};

const splitRow = {
  buyerWallet: BUYER.publicKey(),
  creatorWallet: CREATOR.publicKey(),
  amount: "15",
  currency: "USDC",
  memo: MEMO,
  platformFee: {
    platformWallet: PLATFORM.publicKey(),
    platformAmount: "1.5",
    creatorAmount: "13.5",
  },
};

// Build a signed inner transaction from a list of operation builders.
const buildInner = (ops, { memo = MEMO, source = BUYER } = {}) => {
  const account = new StellarSdk.Account(source.publicKey(), "7");
  const builder = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });
  for (const op of ops) builder.addOperation(op);
  const tx = builder.addMemo(StellarSdk.Memo.text(memo)).setTimeout(300).build();
  tx.sign(source);
  return tx;
};
const pay = (dest, amount, asset = USDC) =>
  StellarSdk.Operation.payment({ destination: dest, asset, amount });

const expectRejected = (tx, row) => {
  expect(() => validateInnerTransaction(tx, row)).toThrow(SponsorshipError);
  try {
    validateInnerTransaction(tx, row);
  } catch (e) {
    expect(e.code).toBe("whitelist_rejected");
    expect(e.httpStatus).toBe(422);
    expect(e.retryUnsponsored).toBe(true);
  }
};

describe("feeSponsorService — boot config", () => {
  const withEnv = (env, fn) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);
    try {
      return fn();
    } finally {
      process.env = saved;
    }
  };

  it("passes when disabled regardless of secret", () => {
    withEnv({ FEE_SPONSOR_ENABLED: "false", FEE_SPONSOR_SECRET: "" }, () => {
      expect(validateFeeSponsorBootConfig().ok).toBe(true);
    });
  });

  it("fails fast when enabled but the secret is missing", () => {
    withEnv({ FEE_SPONSOR_ENABLED: "true", FEE_SPONSOR_SECRET: "" }, () => {
      const res = validateFeeSponsorBootConfig();
      expect(res.ok).toBe(false);
      expect(res.message).toMatch(/FEE_SPONSOR_SECRET/);
    });
  });

  it("fails fast when enabled but the secret is invalid", () => {
    withEnv(
      { FEE_SPONSOR_ENABLED: "true", FEE_SPONSOR_SECRET: "not-a-secret" },
      () => {
        expect(validateFeeSponsorBootConfig().ok).toBe(false);
      }
    );
  });

  it("passes when enabled with a valid secret", () => {
    withEnv(
      { FEE_SPONSOR_ENABLED: "true", FEE_SPONSOR_SECRET: SPONSOR.secret() },
      () => {
        expect(validateFeeSponsorBootConfig().ok).toBe(true);
      }
    );
  });
});

describe("feeSponsorService — sponsor keypair", () => {
  it("parses the secret and never exposes it, only the public key", () => {
    expect(getFeeSponsorPublicKey()).toBe(SPONSOR.publicKey());
    const kp = getFeeSponsorKeypair();
    expect(kp.publicKey()).toBe(SPONSOR.publicKey());
    // The status/public surface must never carry the secret.
    expect(getFeeSponsorPublicKey()).not.toContain(SPONSOR.secret());
  });
});

describe("feeSponsorService — buildExpectedOperations", () => {
  it("derives a single settlement op for a direct row", () => {
    const ops = buildExpectedOperations(directRow);
    expect(ops).toHaveLength(1);
    expect(ops[0].destination).toBe(CREATOR.publicKey());
    expect(ops[0].amountStroops).toBe(toStroops("15"));
  });

  it("derives creator+platform ops (in order) for a fee-split row", () => {
    const ops = buildExpectedOperations(splitRow);
    expect(ops).toHaveLength(2);
    expect(ops[0].destination).toBe(CREATOR.publicKey());
    expect(ops[0].amountStroops).toBe(toStroops("13.5"));
    expect(ops[1].destination).toBe(PLATFORM.publicKey());
    expect(ops[1].amountStroops).toBe(toStroops("1.5"));
  });
});

describe("feeSponsorService — structural whitelist (adversarial matrix)", () => {
  it("accepts a valid, exactly-matching direct payment", () => {
    const tx = buildInner([pay(CREATOR.publicKey(), "15")]);
    expect(validateInnerTransaction(tx, directRow)).toBe(true);
  });

  it("accepts a valid fee-split payment", () => {
    const tx = buildInner([
      pay(CREATOR.publicKey(), "13.5"),
      pay(PLATFORM.publicKey(), "1.5"),
    ]);
    expect(validateInnerTransaction(tx, splitRow)).toBe(true);
  });

  it("rejects a wrong source account", () => {
    expectRejected(
      buildInner([pay(CREATOR.publicKey(), "15")], { source: OTHER }),
      directRow
    );
  });

  it("rejects an extra/foreign changeTrust appended to a valid payment", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        StellarSdk.Operation.changeTrust({ asset: USDC }),
      ]),
      directRow
    );
  });

  it("rejects a second, unexpected payment appended to a valid payment", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        pay(OTHER.publicKey(), "1"),
      ]),
      directRow
    );
  });

  it("rejects a setOptions operation", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        StellarSdk.Operation.setOptions({ homeDomain: "evil.example" }),
      ]),
      directRow
    );
  });

  it("rejects a manageData operation", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        StellarSdk.Operation.manageData({ name: "x", value: "y" }),
      ]),
      directRow
    );
  });

  it("rejects an accountMerge operation", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        StellarSdk.Operation.accountMerge({ destination: OTHER.publicKey() }),
      ]),
      directRow
    );
  });

  it("rejects a createAccount operation", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15"),
        StellarSdk.Operation.createAccount({
          destination: OTHER.publicKey(),
          startingBalance: "1",
        }),
      ]),
      directRow
    );
  });

  it("rejects a pathPaymentStrictReceive operation (allow-list: only plain payment)", () => {
    // A lone non-payment op with the right count still fails: the allow-list
    // permits only `payment`, so any other type — including one not explicitly
    // block-listed — is rejected by construction.
    expectRejected(
      buildInner([
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset: StellarSdk.Asset.native(),
          sendMax: "100",
          destination: CREATOR.publicKey(),
          destAsset: USDC,
          destAmount: "15",
          path: [],
        }),
      ]),
      directRow
    );
  });

  it("rejects a wrong asset (native XLM instead of USDC)", () => {
    expectRejected(
      buildInner([pay(CREATOR.publicKey(), "15", StellarSdk.Asset.native())]),
      directRow
    );
  });

  it("rejects a wrong issuer for the correct code", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "15", new StellarSdk.Asset("USDC", OTHER.publicKey())),
      ]),
      directRow
    );
  });

  it("rejects an amount that is too high", () => {
    expectRejected(buildInner([pay(CREATOR.publicKey(), "16")]), directRow);
  });

  it("rejects an amount that is too low", () => {
    expectRejected(buildInner([pay(CREATOR.publicKey(), "14.9999999")]), directRow);
  });

  it("rejects a wrong destination", () => {
    expectRejected(buildInner([pay(OTHER.publicKey(), "15")]), directRow);
  });

  it("rejects a fee-split where the split amounts do not match platformFee", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "14"),
        pay(PLATFORM.publicKey(), "1"),
      ]),
      splitRow
    );
  });

  it("rejects a memo mismatch", () => {
    expectRejected(
      buildInner([pay(CREATOR.publicKey(), "15")], { memo: "WRONG-MEMO" }),
      directRow
    );
  });

  it("rejects when 1 op is present but 2 are expected (split)", () => {
    expectRejected(buildInner([pay(CREATOR.publicKey(), "13.5")]), splitRow);
  });

  it("rejects when 2 ops are present but 1 is expected (direct)", () => {
    expectRejected(
      buildInner([
        pay(CREATOR.publicKey(), "13.5"),
        pay(PLATFORM.publicKey(), "1.5"),
      ]),
      directRow
    );
  });

  it("rejects a fee-bump envelope where a plain inner transaction is expected", () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    const fb = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
      SPONSOR,
      "200",
      inner,
      networkPassphrase
    );
    expectRejected(fb, directRow);
  });
});

describe("feeSponsorService — fee-bump fee correctness", () => {
  it("prices a 1-op inner over (ops + 1) units and clamps to the ceiling", () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    const config = getFeeSponsorConfig();
    const { baseFeePerOp, totalMaxFeeStroops, units } = computeFeeBumpFee(
      inner,
      config
    );
    expect(units).toBe(2); // 1 inner op + wrapper
    expect(totalMaxFeeStroops).toBe(baseFeePerOp * units);
    expect(totalMaxFeeStroops).toBeLessThanOrEqual(config.maxFeeStroops);

    const fb = wrapWithFeeBump(inner, { keypair: SPONSOR, baseFeePerOp });
    // The built envelope's actual fee is asserted against the SDK, not trusted.
    expect(Number(fb.fee)).toBe(totalMaxFeeStroops);
    expect(Number(fb.fee)).toBeLessThanOrEqual(config.maxFeeStroops);
  });

  it("prices a 2-op inner over 3 units", () => {
    const inner = buildInner([
      pay(CREATOR.publicKey(), "13.5"),
      pay(PLATFORM.publicKey(), "1.5"),
    ]);
    const config = getFeeSponsorConfig();
    const { totalMaxFeeStroops, units } = computeFeeBumpFee(inner, config);
    expect(units).toBe(3);
    expect(totalMaxFeeStroops).toBeLessThanOrEqual(config.maxFeeStroops);
    const fb = wrapWithFeeBump(inner);
    expect(Number(fb.fee)).toBeLessThanOrEqual(config.maxFeeStroops);
  });

  it("refuses when the per-transaction ceiling is too low to fee-bump at all", () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    // Ceiling below (ops + 1) * MIN_BASE_FEE (=200 for 1 op) cannot build.
    expect(() =>
      computeFeeBumpFee(inner, { maxFeeStroops: 150 })
    ).toThrow(SponsorshipError);
    try {
      computeFeeBumpFee(inner, { maxFeeStroops: 150 });
    } catch (e) {
      expect(e.code).toBe("fee_ceiling_too_low");
    }
  });
});

describe("feeSponsorService — fee-bump leaves the inner transaction untouched", () => {
  it("keeps inner bytes and the user signature; the sponsor signs only the wrapper", () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    const innerXdrBefore = inner.toEnvelope().toXDR("base64");

    const fb = wrapWithFeeBump(inner, { keypair: SPONSOR });

    // Fee source is the sponsor; user signature on the inner tx is preserved.
    expect(fb.feeSource).toBe(SPONSOR.publicKey());
    expect(fb.innerTransaction.signatures).toHaveLength(1);
    expect(fb.signatures).toHaveLength(1);

    // Round-trip the envelope; the inner transaction bytes are byte-identical.
    const decoded = StellarSdk.TransactionBuilder.fromXDR(
      fb.toXDR(),
      networkPassphrase
    );
    expect(decoded).toBeInstanceOf(StellarSdk.FeeBumpTransaction);
    expect(decoded.innerTransaction.toEnvelope().toXDR("base64")).toBe(
      innerXdrBefore
    );
    // The inner's own signature is the user's, and the sponsor did not sign it.
    expect(
      decoded.innerTransaction.signatures.map((s) => s.signature().toString("base64"))
    ).toEqual(inner.signatures.map((s) => s.signature().toString("base64")));
  });
});

describe("feeSponsorService — spend caps (durable accounting)", () => {
  beforeEach(async () => {
    await SponsorshipSpend.deleteMany({});
  });

  const config = { maxFeeStroops: 1000000, dailyCapStroops: 1000000, perUserDailyLimit: 2 };

  it("allows spend under all caps", async () => {
    await expect(
      checkSpendCaps({ userId: "user-a", estimatedFeeStroops: 400000, config })
    ).resolves.toBeUndefined();
  });

  it("refuses when the per-UTC-day total cap would be exceeded", async () => {
    await recordSponsorshipSpend({ userId: "user-a", feeStroops: 800000 });
    await expect(
      checkSpendCaps({ userId: "user-b", estimatedFeeStroops: 400000, config })
    ).rejects.toMatchObject({ code: "daily_cap_exceeded", httpStatus: 429 });
  });

  it("refuses when the per-user daily count limit is reached", async () => {
    await recordSponsorshipSpend({ userId: "user-a", feeStroops: 10 });
    await recordSponsorshipSpend({ userId: "user-a", feeStroops: 10 });
    await expect(
      checkSpendCaps({ userId: "user-a", estimatedFeeStroops: 10, config })
    ).rejects.toMatchObject({ code: "per_user_daily_limit", httpStatus: 429 });
    // A different user with headroom is still allowed.
    await expect(
      checkSpendCaps({ userId: "user-b", estimatedFeeStroops: 10, config })
    ).resolves.toBeUndefined();
  });

  it("records spend atomically per UTC day and per user", async () => {
    await recordSponsorshipSpend({ userId: "user-a", feeStroops: 123 });
    await recordSponsorshipSpend({ userId: "user-a", feeStroops: 77 });
    await recordSponsorshipSpend({ userId: "user-b", feeStroops: 50 });
    const doc = await SponsorshipSpend.findOne({ day: utcDay() });
    expect(doc.totalStroops).toBe(250);
    expect(doc.sponsoredCount).toBe(3);
    expect(doc.userCounts.get("user-a")).toBe(2);
    expect(doc.userCounts.get("user-b")).toBe(1);
  });
});

describe("feeSponsorService — prepareSponsoredSubmission", () => {
  const fundedBalance = async () => ({ exists: true, xlmBalance: "100" });
  const emptyBalance = async () => ({ exists: false, xlmBalance: "0" });

  it("validates, wraps, and returns both hashes for a valid submit", async () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    const result = await prepareSponsoredSubmission({
      signedXdr: inner.toXDR(),
      transactionRow: directRow,
      userId: "user-x",
      loadBalance: fundedBalance,
    });
    expect(result.innerHash).toBe(inner.hash().toString("hex"));
    expect(result.outerHash).not.toBe(result.innerHash);
    expect(result.maxFeeStroops).toBeLessThanOrEqual(
      getFeeSponsorConfig().maxFeeStroops
    );
    // The returned envelope decodes to a fee-bump wrapping the exact inner tx.
    const decoded = StellarSdk.TransactionBuilder.fromXDR(
      result.feeBumpXdr,
      networkPassphrase
    );
    expect(decoded.feeSource).toBe(SPONSOR.publicKey());
    expect(decoded.innerTransaction.hash().toString("hex")).toBe(result.innerHash);
  });

  it("propagates a whitelist rejection", async () => {
    const inner = buildInner([pay(OTHER.publicKey(), "15")]);
    await expect(
      prepareSponsoredSubmission({
        signedXdr: inner.toXDR(),
        transactionRow: directRow,
        userId: "user-x",
        loadBalance: fundedBalance,
      })
    ).rejects.toMatchObject({ code: "whitelist_rejected" });
  });

  it("refuses when the sponsor float is underfunded", async () => {
    const inner = buildInner([pay(CREATOR.publicKey(), "15")]);
    await expect(
      prepareSponsoredSubmission({
        signedXdr: inner.toXDR(),
        transactionRow: directRow,
        userId: "user-x",
        loadBalance: emptyBalance,
      })
    ).rejects.toMatchObject({ code: "sponsor_underfunded", httpStatus: 503 });
  });
});
