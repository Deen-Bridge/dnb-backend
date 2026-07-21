import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  buildPaymentTransaction,
  getAccountBalance,
  hasUsdcTrustline,
  isValidPublicKey,
  networkPassphrase,
  server,
  submitTransaction,
  USDC_ISSUER,
  verifyPaymentOperations,
} from "../src/services/stellar/stellarService.js";

const makeHorizonError = (operationCode) => {
  const error = new Error("Horizon rejected transaction");
  error.response = {
    data: {
      extras: {
        result_codes: {
          operations: [operationCode],
        },
      },
    },
  };
  return error;
};

const buildSignedXdr = () => {
  const source = StellarSdk.Keypair.random();
  const destination = StellarSdk.Keypair.random();
  const account = new StellarSdk.Account(source.publicKey(), "1");
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      StellarSdk.Operation.payment({
        destination: destination.publicKey(),
        asset: StellarSdk.Asset.native(),
        amount: "1",
      })
    )
    .setTimeout(30)
    .build();
  tx.sign(source);
  return tx.toXDR();
};

describe("Stellar service payment flow", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds an unsigned USDC payment transaction with the expected operation", async () => {
    const source = StellarSdk.Keypair.random();
    const destination = StellarSdk.Keypair.random();
    jest.spyOn(server, "loadAccount").mockResolvedValue(
      new StellarSdk.Account(source.publicKey(), "100")
    );

    const payment = await buildPaymentTransaction({
      sourcePublicKey: source.publicKey(),
      destinationPublicKey: destination.publicKey(),
      amount: "12.345",
      memo: "DNB-BOOK-1234",
    });

    const tx = StellarSdk.TransactionBuilder.fromXDR(
      payment.xdr,
      networkPassphrase
    );
    expect(tx.signatures).toHaveLength(0);
    expect(tx.operations).toHaveLength(1);
    expect(tx.operations[0]).toMatchObject({
      type: "payment",
      destination: destination.publicKey(),
      amount: "12.3450000",
    });
    expect(tx.operations[0].asset.code).toBe("USDC");
    expect(tx.operations[0].asset.issuer).toBe(USDC_ISSUER);
  });

  it.each([
    ["op_underfunded", "Insufficient USDC balance"],
    [
      "op_no_trust",
      "Recipient does not have a USDC trustline. They need to add USDC to their wallet first.",
    ],
    ["op_no_destination", "Destination account does not exist"],
  ])("maps %s to a clear submit error", async (operationCode, message) => {
    jest
      .spyOn(server, "submitTransaction")
      .mockRejectedValue(makeHorizonError(operationCode));

    await expect(submitTransaction(buildSignedXdr())).rejects.toThrow(message);
  });

  it("verifies matching USDC payment operations", async () => {
    const destination = StellarSdk.Keypair.random().publicKey();
    jest.spyOn(server, "transactions").mockReturnValue({
      transaction: () => ({
        call: async () => ({
          successful: true,
          ledger: 123,
          created_at: "2026-07-21T00:00:00Z",
        }),
      }),
    });
    jest.spyOn(server, "operations").mockReturnValue({
      forTransaction: () => ({
        call: async () => ({
          records: [
            {
              type: "payment",
              asset_code: "USDC",
              asset_issuer: USDC_ISSUER,
              to: destination,
              amount: "9.5000000",
            },
          ],
        }),
      }),
    });

    await expect(
      verifyPaymentOperations("tx_hash", [
        { destination, amount: "9.5" },
      ])
    ).resolves.toEqual({ verified: true });
  });

  it.each([
    { name: "wrong amount", expectedAmount: "10" },
    {
      name: "wrong destination",
      expectedAmount: "9.5",
      expectedDestination: StellarSdk.Keypair.random().publicKey(),
    },
    { name: "wrong asset", expectedAmount: "9.5", assetCode: "XLM" },
  ])(
    "rejects a payment with $name",
    async ({ expectedAmount, expectedDestination, assetCode, assetIssuer }) => {
      const destination = StellarSdk.Keypair.random().publicKey();
      jest.spyOn(server, "transactions").mockReturnValue({
        transaction: () => ({
          call: async () => ({
            successful: true,
            ledger: 123,
            created_at: "2026-07-21T00:00:00Z",
          }),
        }),
      });
      jest.spyOn(server, "operations").mockReturnValue({
        forTransaction: () => ({
          call: async () => ({
            records: [
              {
                type: "payment",
                asset_code: assetCode || "USDC",
                asset_issuer: assetIssuer || USDC_ISSUER,
                to: destination,
                amount: "9.5000000",
              },
            ],
          }),
        }),
      });

      const result = await verifyPaymentOperations("tx_hash", [
        {
          destination: expectedDestination || destination,
          amount: expectedAmount,
        },
      ]);

      expect(result.verified).toBe(false);
      expect(result.reason).toContain("Missing expected USDC payment");
    }
  );

  it("returns balance and trustline information from Horizon", async () => {
    jest.spyOn(server, "loadAccount").mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "3.25" },
        {
          asset_code: "USDC",
          asset_issuer: USDC_ISSUER,
          balance: "44.5",
        },
      ],
    });

    await expect(getAccountBalance("GACCOUNT")).resolves.toEqual({
      exists: true,
      xlmBalance: "3.25",
      usdcBalance: "44.5",
      hasTrustline: true,
    });
    await expect(hasUsdcTrustline("GACCOUNT")).resolves.toBe(true);
  });

  it("treats missing accounts and Horizon failures as no trustline", async () => {
    const notFound = new Error("not found");
    notFound.response = { status: 404 };
    jest.spyOn(server, "loadAccount").mockRejectedValue(notFound);

    await expect(getAccountBalance("GMISSING")).resolves.toEqual({
      exists: false,
      xlmBalance: "0",
      usdcBalance: "0",
      hasTrustline: false,
    });
    await expect(hasUsdcTrustline("GMISSING")).resolves.toBe(false);
  });

  it("validates Stellar public keys without network calls", () => {
    expect(isValidPublicKey(StellarSdk.Keypair.random().publicKey())).toBe(true);
    expect(isValidPublicKey("not-a-stellar-key")).toBe(false);
  });
});
