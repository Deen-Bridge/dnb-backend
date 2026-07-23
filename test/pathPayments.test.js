import * as StellarSdk from "@stellar/stellar-sdk";
import {
  applySlippage,
  calculateFeeSplit,
  toStroops,
  fromStroops,
} from "../src/services/stellar/stellarService.js";

const PLATFORM_WALLET =
  "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

describe("applySlippage", () => {
  it("adds 100 bps (1%) to an amount", () => {
    expect(applySlippage("100", 100)).toBe("101");
  });

  it("adds 50 bps (0.5%) to an amount", () => {
    expect(applySlippage("200", 50)).toBe("201");
  });

  it("handles fractional amounts with 7-decimal precision", () => {
    expect(applySlippage("105.5", 100)).toBe("106.555");
  });

  it("handles 500 bps (5%)", () => {
    expect(applySlippage("100", 500)).toBe("105");
  });

  it("handles 10 bps (0.1%)", () => {
    expect(applySlippage("1000", 10)).toBe("1001");
  });

  it("handles zero bps (no slippage)", () => {
    expect(applySlippage("50", 0)).toBe("50");
  });

  it("produces stroop-exact results", () => {
    const result = applySlippage("0.0000001", 100);
    const stroops = toStroops(result);
    expect(stroops).toBe(
      toStroops("0.0000001") + toStroops("0.0000001") * 100n / 10000n
    );
  });

  it("creates a valid sendMax for the quote use case", () => {
    const sourceAmount = "525.5";
    const sendMax = applySlippage(sourceAmount, 100);
    const sourceStroops = toStroops(sourceAmount);
    const sendMaxStroops = toStroops(sendMax);
    const diff = sendMaxStroops - sourceStroops;
    expect(diff).toBe(sourceStroops * 100n / 10000n);
  });
});

describe("pathPaymentStrictReceive XDR shape (built directly via SDK)", () => {
  it("builds a transaction with a path_payment_strict_receive operation", () => {
    const source = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(source.publicKey(), "1234");

    const usdc = new StellarSdk.Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset: StellarSdk.Asset.native(),
          sendMax: "106.555",
          destination: PLATFORM_WALLET,
          destAsset: usdc,
          destAmount: "100",
          path: [],
        })
      )
      .addMemo(StellarSdk.Memo.text("DNB-TEST"))
      .setTimeout(300)
      .build();

    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      tx.toXDR(),
      StellarSdk.Networks.TESTNET
    );

    expect(parsed.operations).toHaveLength(1);
    const op = parsed.operations[0];
    expect(op.type).toBe("pathPaymentStrictReceive");
    expect(toStroops(op.destAmount.toString())).toBe(toStroops("100"));
    expect(toStroops(op.sendMax.toString())).toBe(toStroops("106.555"));
    expect(op.destination).toBe(PLATFORM_WALLET);
  });

  it("builds two path_payment_strict_receive operations with fee split", () => {
    const source = StellarSdk.Keypair.random();
    const account = new StellarSdk.Account(source.publicKey(), "1234");
    const usdc = new StellarSdk.Asset(
      "USDC",
      "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
    );

    const feeSplit = calculateFeeSplit("100", 5, PLATFORM_WALLET);
    const totalSendMaxStroops = toStroops("106.555");
    const totalDestStroops = toStroops("100");
    const creatorDestStroops = toStroops(feeSplit.creatorAmount);
    const creatorSendMaxStroops =
      (totalSendMaxStroops * creatorDestStroops) / totalDestStroops;
    const platformSendMaxStroops = totalSendMaxStroops - creatorSendMaxStroops;

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase: StellarSdk.Networks.TESTNET,
    })
      .addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset: StellarSdk.Asset.native(),
          sendMax: fromStroops(creatorSendMaxStroops),
          destination: PLATFORM_WALLET,
          destAsset: usdc,
          destAmount: feeSplit.creatorAmount,
          path: [],
        })
      )
      .addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset: StellarSdk.Asset.native(),
          sendMax: fromStroops(platformSendMaxStroops),
          destination: PLATFORM_WALLET,
          destAsset: usdc,
          destAmount: feeSplit.platformAmount,
          path: [],
        })
      )
      .addMemo(StellarSdk.Memo.text("DNB-TEST"))
      .setTimeout(300)
      .build();

    const parsed = StellarSdk.TransactionBuilder.fromXDR(
      tx.toXDR(),
      StellarSdk.Networks.TESTNET
    );

    expect(parsed.operations).toHaveLength(2);
    parsed.operations.forEach((op) => {
      expect(op.type).toBe("pathPaymentStrictReceive");
    });

    const op1Dest = toStroops(parsed.operations[0].destAmount);
    const op2Dest = toStroops(parsed.operations[1].destAmount);
    expect(op1Dest + op2Dest).toBe(toStroops("100"));

    const op1SendMax = toStroops(parsed.operations[0].sendMax);
    const op2SendMax = toStroops(parsed.operations[1].sendMax);
    expect(op1SendMax + op2SendMax).toBe(totalSendMaxStroops);
  });
});

describe("toStroops / fromStroops consistency", () => {
  it("round-trips correctly", () => {
    const amounts = ["0", "1", "100.5", "0.0000001", "9999.9999999"];
    for (const a of amounts) {
      expect(fromStroops(toStroops(a))).toBe(a);
    }
  });

  it("fromStroops / toStroops on large numbers", () => {
    const large = "1000000000.0000001";
    expect(fromStroops(toStroops(large))).toBe(large);
  });
});
