import * as StellarSdk from "@stellar/stellar-sdk";
import { jest } from "@jest/globals";
import {
  FeeSponsorshipError,
  validateInnerTransaction,
  wrapWithFeeBump,
  reserveSponsorship,
} from "../src/services/stellar/feeSponsorService.js";
import FeeSponsorDailySpend from "../src/models/FeeSponsorDailySpend.js";
import {
  server,
  USDC,
  networkPassphrase,
} from "../src/services/stellar/stellarService.js";

const source = StellarSdk.Keypair.random();
const creator = StellarSdk.Keypair.random();
const platform = StellarSdk.Keypair.random();
const itemId = "507f1f77bcf86cd799439011";

const row = {
  type: "purchase",
  buyerWallet: source.publicKey(),
  creatorWallet: creator.publicKey(),
  itemType: "book",
  itemId,
  amount: "10",
};

const build = ({
  signer = source,
  sourceKey = source,
  operations,
  memo = "DNB-BOOK-99439011",
} = {}) => {
  let builder = new StellarSdk.TransactionBuilder(
    new StellarSdk.Account(sourceKey.publicKey(), "1"),
    { fee: StellarSdk.BASE_FEE, networkPassphrase }
  );
  for (const operation of operations || [
    StellarSdk.Operation.payment({
      destination: creator.publicKey(),
      asset: USDC,
      amount: "10",
    }),
  ]) builder = builder.addOperation(operation);
  const tx = builder.addMemo(StellarSdk.Memo.text(memo)).setTimeout(300).build();
  if (signer) tx.sign(signer);
  return tx;
};

describe("fee sponsorship transaction whitelist", () => {
  it("accepts the exact signed payment built for the transaction row", () => {
    expect(validateInnerTransaction(build().toXDR(), row).source).toBe(source.publicKey());
  });

  it.each([
    ["wrong source", () => build({ sourceKey: platform, signer: platform }), "wrong_source"],
    ["wrong memo", () => build({ memo: "DNB-WRONG" }), "wrong_memo"],
    ["extra operation", () => build({ operations: [
      StellarSdk.Operation.payment({ destination: creator.publicKey(), asset: USDC, amount: "10" }),
      StellarSdk.Operation.payment({ destination: platform.publicKey(), asset: USDC, amount: "1" }),
    ] }), "wrong_operation_count"],
    ["wrong asset", () => build({ operations: [StellarSdk.Operation.payment({
      destination: creator.publicKey(), asset: StellarSdk.Asset.native(), amount: "10",
    })] }), "operation_not_allowed"],
    ["wrong destination", () => build({ operations: [StellarSdk.Operation.payment({
      destination: platform.publicKey(), asset: USDC, amount: "10",
    })] }), "operation_not_allowed"],
    ["wrong amount", () => build({ operations: [StellarSdk.Operation.payment({
      destination: creator.publicKey(), asset: USDC, amount: "9",
    })] }), "operation_not_allowed"],
  ])("rejects %s", (_label, makeTransaction, code) => {
    expect(() => validateInnerTransaction(makeTransaction().toXDR(), row)).toThrow(FeeSponsorshipError);
    try { validateInnerTransaction(makeTransaction().toXDR(), row); } catch (error) {
      expect(error.code).toBe(code);
    }
  });

  it("requires both exact operations for a configured fee split", () => {
    const splitRow = {
      ...row,
      platformFee: {
        creatorAmount: "9",
        platformAmount: "1",
        platformWallet: platform.publicKey(),
      },
    };
    const split = build({ operations: [
      StellarSdk.Operation.payment({ destination: creator.publicKey(), asset: USDC, amount: "9" }),
      StellarSdk.Operation.payment({ destination: platform.publicKey(), asset: USDC, amount: "1" }),
    ] });
    expect(validateInnerTransaction(split.toXDR(), splitRow).operations).toHaveLength(2);
  });
});

describe("fee-bump construction", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it("signs a fee-bump envelope without exceeding the configured total cap", async () => {
    process.env.FEE_SPONSOR_ENABLED = "true";
    process.env.FEE_SPONSOR_SECRET = StellarSdk.Keypair.random().secret();
    process.env.FEE_SPONSOR_MAX_FEE_STROOPS = "250";
    jest.spyOn(server, "fetchBaseFee").mockResolvedValue(100);
    const wrapped = await wrapWithFeeBump(build());
    expect(wrapped.feeBump.innerTransaction.hash().toString("hex")).toBe(wrapped.innerHash);
    expect(Number(wrapped.feeBump.fee)).toBeLessThanOrEqual(250);
    expect(wrapped.feeBump.signatures).toHaveLength(1);
  });

  it("rejects when the total fee cap cannot cover wrapper semantics", async () => {
    process.env.FEE_SPONSOR_ENABLED = "true";
    process.env.FEE_SPONSOR_SECRET = StellarSdk.Keypair.random().secret();
    process.env.FEE_SPONSOR_MAX_FEE_STROOPS = "150";
    jest.spyOn(server, "fetchBaseFee").mockResolvedValue(100);
    await expect(wrapWithFeeBump(build())).rejects.toMatchObject({ code: "fee_cap_too_low" });
  });

  it("enforces daily spend and per-user count in one atomic reservation", async () => {
    process.env.FEE_SPONSOR_DAILY_CAP_STROOPS = "1000";
    process.env.FEE_SPONSOR_PER_USER_DAILY_LIMIT = "2";
    const update = jest.spyOn(FeeSponsorDailySpend, "findOneAndUpdate").mockResolvedValue(null);
    await expect(reserveSponsorship("user-1", 300)).rejects.toMatchObject({ code: "daily_limit" });
    const [filter, mutation, options] = update.mock.calls[0];
    expect(filter.totalStroops.$lte).toBe(700);
    expect(filter.$or[0]["perUser.user-1"].$lt).toBe(2);
    expect(mutation.$inc.totalStroops).toBe(300);
    expect(options).toMatchObject({ upsert: true, new: true });
  });
});
