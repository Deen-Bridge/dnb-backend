import { jest } from "@jest/globals";
import * as StellarSdk from "@stellar/stellar-sdk";
import {
  buildCreateClaimableBalanceTx,
  buildClaimTx,
  resolveBalanceId,
  getClaimableBalance,
  validateSignedGiftXdr,
  describePredicate,
} from "../src/services/stellar/claimableBalanceService.js";
import {
  server,
  networkPassphrase,
  USDC_ISSUER,
} from "../src/services/stellar/stellarService.js";

const TESTNET_USDC = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// Craft a TransactionResult XDR containing a create_claimable_balance success
// whose balanceId is the hex-encoded ClaimableBalanceId of the given hash.
const craftCreateBalanceResultXdr = (hashHex) => {
  const x = StellarSdk.xdr;
  const balId = x.ClaimableBalanceId.claimableBalanceIdTypeV0(
    Buffer.from(hashHex, "hex")
  );
  const createResult =
    x.CreateClaimableBalanceResult.createClaimableBalanceSuccess(balId);
  const opTr = x.OperationResultTr.createClaimableBalance(createResult);
  const opRes = new x.OperationResult(x.OperationResultCode.opInner(), opTr);
  const result = x.TransactionResultResult.txSuccess([opRes]);
  const txResult = new x.TransactionResult({
    feeCharged: 100n,
    result,
    ext: new x.TransactionResultExt(0),
  });
  return {
    balanceId: balId.toXDR("hex"),
    resultXdr: txResult.toXDR("base64"),
  };
};

describe("claimableBalanceService: build + predicates", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("builds a create_claimable_balance tx with complementary recipient/sender predicates", async () => {
    const source = StellarSdk.Keypair.random();
    const claimant = StellarSdk.Keypair.random();
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    jest
      .spyOn(server, "loadAccount")
      .mockResolvedValue(new StellarSdk.Account(source.publicKey(), "1"));

    const built = await buildCreateClaimableBalanceTx({
      sourcePublicKey: source.publicKey(),
      claimantPublicKey: claimant.publicKey(),
      amount: "15",
      expiresAt,
    });

    const tx = StellarSdk.TransactionBuilder.fromXDR(built.xdr, networkPassphrase);
    expect(tx.operations).toHaveLength(1);
    const op = tx.operations[0];
    expect(op.type).toBe("createClaimableBalance");
    expect(op.asset.code).toBe("USDC");
    expect(op.asset.issuer).toBe(TESTNET_USDC);
    expect(op.amount).toBe("15.0000000");
    expect(op.claimants).toHaveLength(2);

    const [recipientClaimant, senderClaimant] = op.claimants;
    expect(recipientClaimant.destination).toBe(claimant.publicKey());
    expect(describePredicate(recipientClaimant.predicate)).toEqual({
      type: "before_absolute_time",
      time: String(expiresAt.getTime()),
    });
    expect(senderClaimant.destination).toBe(source.publicKey());
    expect(describePredicate(senderClaimant.predicate)).toEqual({
      type: "not",
      child: {
        type: "before_absolute_time",
        time: String(expiresAt.getTime()),
      },
    });
  });

  it("prepends changeTrust(USDC) when the claimant has no USDC trustline", async () => {
    const claimant = StellarSdk.Keypair.random();
    const balanceId = "00000000" + "ab".repeat(32);

    // First loadAccount (hasUsdcTrustline → getAccountBalance) returns no USDC
    // balance; second loadAccount returns the source account for the builder.
    jest
      .spyOn(server, "loadAccount")
      .mockResolvedValueOnce({
        balances: [{ asset_type: "native", balance: "2.5" }],
      })
      .mockResolvedValueOnce(new StellarSdk.Account(claimant.publicKey(), "1"));

    const built = await buildClaimTx({
      claimantPublicKey: claimant.publicKey(),
      balanceId,
    });

    const tx = StellarSdk.TransactionBuilder.fromXDR(built.xdr, networkPassphrase);
    expect(built.includesChangeTrust).toBe(true);
    expect(tx.operations.map((o) => o.type)).toEqual([
      "changeTrust",
      "claimClaimableBalance",
    ]);
    expect(tx.operations[0].line.code).toBe("USDC");
  });

  it("omits changeTrust when the claimant already has a USDC trustline", async () => {
    const claimant = StellarSdk.Keypair.random();
    const balanceId = "00000000" + "cd".repeat(32);

    jest
      .spyOn(server, "loadAccount")
      .mockResolvedValueOnce({
        balances: [
          { asset_type: "native", balance: "2.5" },
          { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: TESTNET_USDC, balance: "1" },
        ],
      })
      .mockResolvedValueOnce(new StellarSdk.Account(claimant.publicKey(), "1"));

    const built = await buildClaimTx({
      claimantPublicKey: claimant.publicKey(),
      balanceId,
    });

    expect(built.includesChangeTrust).toBe(false);
    const tx = StellarSdk.TransactionBuilder.fromXDR(built.xdr, networkPassphrase);
    expect(tx.operations.map((o) => o.type)).toEqual(["claimClaimableBalance"]);
  });
});

describe("claimableBalanceService: validateSignedGiftXdr", () => {
  const source = StellarSdk.Keypair.random();
  const claimant = StellarSdk.Keypair.random();
  const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  const buildSignedGift = ({ amount = "15", asset = new StellarSdk.Asset("USDC", TESTNET_USDC), extraClaimant } = {}) => {
    const account = new StellarSdk.Account(source.publicKey(), "1");
    const claimants = [
      new StellarSdk.Claimant(claimant.publicKey(), StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresAt)),
      new StellarSdk.Claimant(source.publicKey(), StellarSdk.Claimant.predicateNot(StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresAt))),
      ...(extraClaimant ? [extraClaimant] : []),
    ];
    const tx = new StellarSdk.TransactionBuilder(account, { fee: StellarSdk.BASE_FEE, networkPassphrase })
      .addOperation(StellarSdk.Operation.createClaimableBalance({ asset, amount, claimants }))
      .setTimeout(300)
      .build();
    tx.sign(source);
    return tx.toXDR();
  };

  it("accepts a correctly-formed signed gift XDR", () => {
    const xdr = buildSignedGift();
    expect(() =>
      validateSignedGiftXdr(xdr, {
        amount: "15",
        recipientWallet: claimant.publicKey(),
        senderWallet: source.publicKey(),
        expiresAt,
      })
    ).not.toThrow();
  });

  it("rejects a tampered amount", () => {
    const xdr = buildSignedGift({ amount: "999" });
    expect(() =>
      validateSignedGiftXdr(xdr, {
        amount: "15",
        recipientWallet: claimant.publicKey(),
        senderWallet: source.publicKey(),
        expiresAt,
      })
    ).toThrow(/amount mismatch/i);
  });

  it("rejects a wrong asset", () => {
    const xdr = buildSignedGift({ asset: StellarSdk.Asset.native() });
    expect(() =>
      validateSignedGiftXdr(xdr, {
        amount: "15",
        recipientWallet: claimant.publicKey(),
        senderWallet: source.publicKey(),
        expiresAt,
      })
    ).toThrow(/wrong asset/i);
  });

  it("rejects a missing recipient claimant", () => {
    const other = StellarSdk.Keypair.random();
    const xdr = buildSignedGift();
    expect(() =>
      validateSignedGiftXdr(xdr, {
        amount: "15",
        recipientWallet: other.publicKey(), // not a claimant
        senderWallet: source.publicKey(),
        expiresAt,
      })
    ).toThrow(/recipient claimant/i);
  });
});

describe("claimableBalanceService: resolveBalanceId + getClaimableBalance", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("parses the balance id from the transaction result XDR (not the tx hash)", async () => {
    const txHash = "a".repeat(64);
    const { balanceId, resultXdr } = craftCreateBalanceResultXdr("ab".repeat(32));

    jest.spyOn(server, "transactions").mockReturnValue({
      transaction: () => ({ call: async () => ({ result_xdr: resultXdr }) }),
    });

    const resolved = await resolveBalanceId(txHash, { amount: "15" });
    expect(resolved).toBe(balanceId);
    expect(resolved).not.toBe(txHash);
  });

  it("falls back to the forClaimant query when result XDR is unavailable", async () => {
    const txHash = "b".repeat(64);
    jest.spyOn(server, "transactions").mockReturnValue({
      transaction: () => ({ call: async () => ({}) }),
    });
    jest.spyOn(server, "claimableBalances").mockReturnValue({
      forClaimant: () => ({
        call: async () => ({
          records: [{ id: "fallback-balance-id", amount: "15.0000000", asset: `USDC:${USDC_ISSUER}` }],
        }),
      }),
    });

    const resolved = await resolveBalanceId(txHash, {
      amount: "15",
      claimantPublicKey: "GCLAIMANT",
    });
    expect(resolved).toBe("fallback-balance-id");
  });

  it("returns { exists: true } with the record for a known balance", async () => {
    jest.spyOn(server, "claimableBalances").mockReturnValue({
      claimableBalance: () => ({
        call: async () => ({ id: "balance-1", state: "available", amount: "15.0000000" }),
      }),
    });
    const result = await getClaimableBalance("balance-1");
    expect(result.exists).toBe(true);
    expect(result.record.state).toBe("available");
  });

  it("returns { exists: false } for a 404", async () => {
    const err = new Error("not found");
    err.response = { status: 404 };
    jest.spyOn(server, "claimableBalances").mockReturnValue({
      claimableBalance: () => ({ call: async () => { throw err; } }),
    });
    const result = await getClaimableBalance("missing");
    expect(result).toEqual({ exists: false });
  });
});
