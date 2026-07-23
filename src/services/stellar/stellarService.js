// services/stellar/stellarService.js
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import { observeHorizonDuration } from "../../config/metrics.js";

import { client } from "./horizonClient.js";

const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const networkPassphrase =
  NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const USDC = new StellarSdk.Asset("USDC", USDC_ISSUER);

const DONATION_WALLET_PUBLIC_KEY = process.env.DONATION_WALLET_PUBLIC_KEY || "";

const PLATFORM_WALLET_PUBLIC_KEY = process.env.PLATFORM_WALLET_PUBLIC_KEY || "";
const PLATFORM_FEE_PERCENT = (() => {
  const percent = Number(process.env.PLATFORM_FEE_PERCENT || 0);
  if (!Number.isFinite(percent) || percent < 0) {
    return 0;
  }
  if (percent > 20) {
    logger.warn(
      `PLATFORM_FEE_PERCENT (${percent}) exceeds the maximum of 20, capping at 20`
    );
    return 20;
  }
  return percent;
})();

const STROOPS_PER_UNIT = 10000000n;

async function timedHorizonCall(operation, fn) {
  const start = Date.now();
  try {
    const result = await fn();
    observeHorizonDuration(operation, "success", Date.now() - start);
    return result;
  } catch (error) {
    observeHorizonDuration(operation, "error", Date.now() - start);
    throw error;
  }
}

/**
 * Convert a decimal amount (string or number) to stroops (BigInt, 7 decimals)
 * @param {string|number} amount - The amount to convert
 * @returns {BigInt} - Amount in stroops
 */
export const toStroops = (amount) => {
  const [whole, frac = ""] = amount.toString().split(".");
  return (
    BigInt(whole || "0") * STROOPS_PER_UNIT +
    BigInt((frac + "0000000").slice(0, 7))
  );
};

/**
 * Convert stroops (BigInt) back to a decimal amount string
 * @param {BigInt} stroops - Amount in stroops
 * @returns {string} - Decimal amount string
 */
export const fromStroops = (stroops) => {
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};

export const calculateFeeSplit = (
  amount,
  feePercent = PLATFORM_FEE_PERCENT,
  platformWallet = PLATFORM_WALLET_PUBLIC_KEY
) => {
  if (!feePercent || feePercent <= 0 || !platformWallet) {
    return null;
  }

  const totalStroops = toStroops(amount);
  const feeBasisPoints = BigInt(Math.round(feePercent * 100));
  const platformStroops = (totalStroops * feeBasisPoints) / 10000n;
  const creatorStroops = totalStroops - platformStroops;

  if (platformStroops <= 0n) {
    return null;
  }

  return {
    creatorAmount: fromStroops(creatorStroops),
    platformAmount: fromStroops(platformStroops),
    feePercent,
    platformWallet,
  };
};

export const buildSep7Uri = ({ destination, amount, memo }) => {
  const params = new URLSearchParams({
    destination,
    amount: amount.toString(),
    asset_code: "USDC",
    asset_issuer: USDC_ISSUER,
  });

  if (memo) {
    params.set("memo", memo);
    params.set("memo_type", "MEMO_TEXT");
  }

  return `web+stellar:pay?${params.toString()}`;
};

export const isValidPublicKey = (publicKey) => {
  try {
    StellarSdk.Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
};

export const getAccountBalance = async (publicKey) => {
  try {
    const account = await timedHorizonCall("loadAccount", () =>
      client.execute(server => server.loadAccount(publicKey))
    );
    const usdcBalance = account.balances.find(
      (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
    );

    return {
      exists: true,
      xlmBalance:
        account.balances.find((b) => b.asset_type === "native")?.balance || "0",
      usdcBalance: usdcBalance?.balance || "0",
      hasTrustline: !!usdcBalance,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        exists: false,
        xlmBalance: "0",
        usdcBalance: "0",
        hasTrustline: false,
      };
    }
    logger.error("Error fetching account balance:", error);
    throw error;
  }
};

export const buildPaymentTransaction = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  memo,
  applyPlatformFee = false,
}) => {
  try {
    const sourceAccount = await timedHorizonCall("loadAccount", () =>
      client.execute(server => server.loadAccount(sourcePublicKey))
    );

    const feeSplit = applyPlatformFee ? calculateFeeSplit(amount) : null;

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    if (feeSplit) {
      builder
        .addOperation(
          StellarSdk.Operation.payment({
            destination: destinationPublicKey,
            asset: USDC,
            amount: feeSplit.creatorAmount,
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: feeSplit.platformWallet,
            asset: USDC,
            amount: feeSplit.platformAmount,
          })
        );
    } else {
      builder.addOperation(
        StellarSdk.Operation.payment({
          destination: destinationPublicKey,
          asset: USDC,
          amount: amount.toString(),
        })
      );
    }

    const transaction = builder
      .addMemo(StellarSdk.Memo.text(memo || "DeenBridge Purchase"))
      .setTimeout(300)
      .build();

    return {
      xdr: transaction.toXDR(),
      hash: transaction.hash().toString("hex"),
      networkPassphrase,
      feeSplit,
    };
  } catch (error) {
    logger.error("Error building payment transaction:", error);
    throw error;
  }
};

export const submitTransaction = async (signedXdr) => {
  try {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      networkPassphrase
    );

    // Using mode: 'submit' and passing a verifyFn to safely handle timeouts
    const verifyFn = async () => {
      const ver = await verifyTransaction(transaction.hash().toString("hex"));
      if (ver.exists) {
        return { hash: transaction.hash().toString("hex"), ledger: ver.ledger, successful: ver.successful };
      }
      return null;
    };

    const result = await timedHorizonCall("submitTransaction", () =>
      client.execute(server => server.submitTransaction(transaction), { mode: 'submit', verifyFn })
    );
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful,
    };
  } catch (error) {
    logger.error("Error submitting transaction:", error);

    if (error.response?.data?.extras?.result_codes) {
      const codes = error.response.data.extras.result_codes;
      if (codes.operations?.includes("op_underfunded")) {
        throw new Error("Insufficient USDC balance");
      }
      if (codes.operations?.includes("op_no_trust")) {
        throw new Error(
          "Recipient does not have a USDC trustline. They need to add USDC to their wallet first."
        );
      }
      if (codes.operations?.includes("op_no_destination")) {
        throw new Error("Destination account does not exist");
      }
    }

    throw error;
  }
};

export const verifyTransaction = async (txHash) => {
  try {
    const tx = await timedHorizonCall("fetchTransaction", () =>
      client.execute(server => server.transactions().transaction(txHash).call())
    );
    const operations = await timedHorizonCall("fetchOperations", () =>
      client.execute(server => server.operations().forTransaction(txHash).call())
    );

    return {
      exists: true,
      successful: tx.successful,
      ledger: tx.ledger,
      createdAt: tx.created_at,
      operations: operations.records,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return { exists: false };
    }
    logger.error("Error verifying transaction:", error);
    throw error;
  }
};

export const verifyPaymentOperations = async (txHash, expectedPayments) => {
  try {
    const verification = await verifyTransaction(txHash);

    if (!verification.exists) {
      return { verified: false, reason: "Transaction not found on network" };
    }
    if (!verification.successful) {
      return { verified: false, reason: "Transaction was not successful" };
    }

    const paymentOps = verification.operations.filter(
      (op) =>
        op.type === "payment" &&
        op.asset_code === "USDC" &&
        op.asset_issuer === USDC_ISSUER
    );

    for (const expected of expectedPayments) {
      const match = paymentOps.find(
        (op) =>
          op.to === expected.destination &&
          toStroops(op.amount) === toStroops(expected.amount)
      );
      if (!match) {
        return {
          verified: false,
          reason: `Missing expected USDC payment of ${expected.amount} to ${expected.destination}`,
        };
      }
    }

    return { verified: true };
  } catch (error) {
    logger.error("Error verifying payment operations:", error);
    return { verified: false, reason: "Verification failed" };
  }
};

export const hasUsdcTrustline = async (publicKey) => {
  try {
    const balance = await getAccountBalance(publicKey);
    return balance.hasTrustline;
  } catch (error) {
    return false;
  }
};

export const getExplorerUrl = (txHash) => {
  const baseUrl =
    NETWORK === "mainnet"
      ? "https://stellar.expert/explorer/public/tx/"
      : "https://stellar.expert/explorer/testnet/tx/";
  return baseUrl + txHash;
};

export const getAccountExplorerUrl = (publicKey) => {
  const baseUrl =
    NETWORK === "mainnet"
      ? "https://stellar.expert/explorer/public/account/"
      : "https://stellar.expert/explorer/testnet/account/";
  return baseUrl + publicKey;
};

// Export client.endpoints[0].server as a fallback for other modules not yet refactored (e.g. payoutService)
export const server = client.endpoints[0].server;

export {
  USDC,
  USDC_ISSUER,
  NETWORK,
  networkPassphrase,
  DONATION_WALLET_PUBLIC_KEY,
  PLATFORM_FEE_PERCENT,
  PLATFORM_WALLET_PUBLIC_KEY,
};
