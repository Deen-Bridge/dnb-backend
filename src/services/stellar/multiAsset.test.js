import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getAssetConfig } from "../../config/assets.js";

const TEST_PUBLIC_KEY = StellarSdk.Keypair.random().publicKey();

const makeFakeAccount = (publicKey, balances, sequence = "12345") => {
  const account = new StellarSdk.Account(publicKey, sequence);
  account.balances = balances;
  account.subentry_count = 0;
  account.data_attr = {};
  return account;
};

const mockServer = {
  loadAccount: jest.fn(async () =>
    makeFakeAccount(TEST_PUBLIC_KEY, [{ asset_type: "native", balance: "1000" }])
  ),
};

const mockExecute = jest.fn(async (fn) => fn(mockServer));

jest.unstable_mockModule("./horizonClient.js", () => ({
  client: { execute: mockExecute, endpoints: [{ server: mockServer }] },
}));

const {
  buildPaymentTransaction,
  hasTrustline,
  hasUsdcTrustline,
  getAccountBalance,
  USDC,
} = await import("./stellarService.js");

describe("buildPaymentTransaction - native asset (XLM)", () => {
  it("builds a payment op with a native asset and no issuer", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();
    const result = await buildPaymentTransaction({
      sourcePublicKey: TEST_PUBLIC_KEY,
      destinationPublicKey: destination,
      amount: "50",
      assetCode: "XLM",
    });

    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      result.xdr,
      StellarSdk.Networks.TESTNET
    );
    const op = parsed.operations[0];
    expect(op.type).toBe("payment");
    expect(op.asset.isNative()).toBe(true);
    expect(op.destination).toBe(destination);
    expect(result.assetCode).toBe("XLM");
  });
});

describe("buildPaymentTransaction - USDC default path (unchanged)", () => {
  it("builds a payment op in USDC when assetCode is omitted", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();
    const result = await buildPaymentTransaction({
      sourcePublicKey: TEST_PUBLIC_KEY,
      destinationPublicKey: destination,
      amount: "10",
    });

    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      result.xdr,
      StellarSdk.Networks.TESTNET
    );
    const op = parsed.operations[0];
    expect(op.asset.getCode()).toBe("USDC");
    expect(op.asset.getIssuer()).toBe(USDC.getIssuer());
    expect(result.assetCode).toBe("USDC");
  });
});

describe("trustline check for a non-USDC asset (EURC)", () => {
  const eurcConfig = getAssetConfig("EURC", "testnet");

  it("reports no EURC trustline when the account only holds USDC", async () => {
    mockServer.loadAccount.mockResolvedValueOnce(
      makeFakeAccount(TEST_PUBLIC_KEY, [
        { asset_type: "native", balance: "1000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "20",
        },
      ])
    );

    const result = await hasTrustline(TEST_PUBLIC_KEY, "EURC");
    expect(result).toBe(false);
  });

  it("reports an EURC trustline when the account holds an EURC balance line", async () => {
    mockServer.loadAccount.mockResolvedValueOnce(
      makeFakeAccount(TEST_PUBLIC_KEY, [
        { asset_type: "native", balance: "1000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "EURC",
          asset_issuer: eurcConfig.issuer,
          balance: "5",
        },
      ])
    );

    const result = await hasTrustline(TEST_PUBLIC_KEY, "EURC");
    expect(result).toBe(true);
  });

  it("hasUsdcTrustline (back-compat wrapper) still checks USDC specifically", async () => {
    mockServer.loadAccount.mockResolvedValueOnce(
      makeFakeAccount(TEST_PUBLIC_KEY, [
        { asset_type: "native", balance: "1000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "20",
        },
      ])
    );

    expect(await hasUsdcTrustline(TEST_PUBLIC_KEY)).toBe(true);
  });
});

describe("getAccountBalance - multi-asset shape", () => {
  it("returns per-asset balances and trustlines alongside back-compat fields", async () => {
    mockServer.loadAccount.mockResolvedValueOnce(
      makeFakeAccount(TEST_PUBLIC_KEY, [
        { asset_type: "native", balance: "1000" },
        {
          asset_type: "credit_alphanum4",
          asset_code: "USDC",
          asset_issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          balance: "20",
        },
      ])
    );

    const result = await getAccountBalance(TEST_PUBLIC_KEY);
    expect(result.usdcBalance).toBe("20");
    expect(result.hasTrustline).toBe(true);
    expect(result.balances.USDC).toBe("20");
    expect(result.balances.EURC).toBe("0");
    expect(result.trustlines.EURC).toBe(false);
  });
});