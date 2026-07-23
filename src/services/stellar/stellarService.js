// services/stellar/stellarService.js
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import { observeHorizonDuration } from "../../config/metrics.js";

const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const HORIZON_URL =
  NETWORK === "mainnet"
    ? "https://horizon.stellar.org"
    : "https://horizon-testnet.stellar.org";

const server = new StellarSdk.Horizon.Server(HORIZON_URL);
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

export const STROOPS_PER_UNIT = 10000000n;

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

export const applySlippage = (amount, bps) => {
  const stroops = toStroops(amount);
  const extra = (stroops * BigInt(bps)) / 10000n;
  return fromStroops(stroops + extra);
};

const applySlippageStroops = (stroops, bps) => {
  return stroops + (stroops * BigInt(bps)) / 10000n;
};

export const findPaymentPaths = async (sendAsset, destAmount) => {
  try {
    const records = await timedHorizonCall("strictReceivePaths", () =>
      server.strictReceivePaths([sendAsset], USDC, destAmount.toString()).call()
    );
    return records.records;
  } catch (error) {
    if (error.response?.status === 400 || error.response?.status === 404) {
      return [];
    }
    logger.error("Error finding payment paths:", error);
    throw error;
  }
};

const assetFromHorizonRecord = (record) => {
  if (record.asset_type === "native") {
    return StellarSdk.Asset.native();
  }
  return new StellarSdk.Asset(record.asset_code, record.asset_issuer);
};

export const buildPathPaymentTransaction = async ({
  sourcePublicKey,
  destinationPublicKey,
  destAmount,
  sendAsset,
  sendMax,
  path = [],
  memo,
  applyPlatformFee = false,
}) => {
  try {
    const sourceAccount = await timedHorizonCall("loadAccount", () =>
      server.loadAccount(sourcePublicKey)
    );

    const feeSplit = applyPlatformFee ? calculateFeeSplit(destAmount) : null;
    const totalDestStroops = toStroops(destAmount);
    const sendMaxStroops = toStroops(sendMax);

    const pathAssets = path.map(assetFromHorizonRecord);

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    if (feeSplit) {
      const creatorDestStroops = toStroops(feeSplit.creatorAmount);
      const creatorSendMaxStroops =
        (sendMaxStroops * creatorDestStroops) / totalDestStroops;
      const platformSendMaxStroops = sendMaxStroops - creatorSendMaxStroops;

      builder.addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset,
          sendMax: fromStroops(creatorSendMaxStroops),
          destination: destinationPublicKey,
          destAsset: USDC,
          destAmount: feeSplit.creatorAmount,
          path: pathAssets,
        })
      );

      if (platformSendMaxStroops > 0n) {
        builder.addOperation(
          StellarSdk.Operation.pathPaymentStrictReceive({
            sendAsset,
            sendMax: fromStroops(platformSendMaxStroops),
            destination: feeSplit.platformWallet,
            destAsset: USDC,
            destAmount: feeSplit.platformAmount,
            path: pathAssets,
          })
        );
      }
    } else {
      builder.addOperation(
        StellarSdk.Operation.pathPaymentStrictReceive({
          sendAsset,
          sendMax: sendMax.toString(),
          destination: destinationPublicKey,
          destAsset: USDC,
          destAmount: destAmount.toString(),
          path: pathAssets,
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
    logger.error("Error building path payment transaction:", error);
    throw error;
  }
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

const parseAccountSummary = (account) => {
  const usdcBalance = account.balances?.find(
    (b) => b.asset_code === "USDC" && b.asset_issuer === USDC_ISSUER
  );
  const xlmBalance = account.balances?.find((b) => b.asset_type === "native");

  return {
    xlmBalance: xlmBalance?.balance || "0",
    usdcBalance: usdcBalance?.balance || "0",
    hasTrustline: !!usdcBalance,
    subentryCount: account.subentry_count ?? 0,
  };
};

export const getAccountBalance = async (publicKey) => {
  try {
    const account = await timedHorizonCall("loadAccount", () =>
      server.loadAccount(publicKey)
    );
    const summary = parseAccountSummary(account);

    return {
      exists: true,
      xlmBalance: summary.xlmBalance,
      usdcBalance: summary.usdcBalance,
      hasTrustline: summary.hasTrustline,
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

// SEP-29: an account opts into requiring a memo on incoming payments by
// setting a manageData entry with key "config.memo_required" (value is
// conventionally "1", base64-encoded by Horizon like all data_attr values).
export const MEMO_REQUIRED_DATA_KEY = "config.memo_required";

export const isMemoRequired = (account) => {
  const raw = account?.data_attr?.[MEMO_REQUIRED_DATA_KEY];
  if (!raw) return false;
  try {
    const decoded = Buffer.from(raw, "base64").toString("utf8").trim();
    return decoded === "1" || decoded.toLowerCase() === "true";
  } catch {
    return false;
  }
};

export const PREFLIGHT_REASON_CODES = Object.freeze({
  SOURCE_ACCOUNT_MISSING: "source_account_missing",
  DESTINATION_ACCOUNT_MISSING: "destination_account_missing",
  DESTINATION_NO_TRUSTLINE: "destination_no_trustline",
  SOURCE_INSUFFICIENT_BALANCE: "source_insufficient_balance",
  SOURCE_INSUFFICIENT_RESERVE: "source_insufficient_reserve",
  DESTINATION_MEMO_REQUIRED: "destination_memo_required",
});

// Stellar protocol base reserve is 0.5 XLM per ledger entry (2 base entries
// per account, plus one more per subentry: trustlines, offers, signers, data).
const BASE_RESERVE_STROOPS = 5000000n;

const loadAccountOrNull = async (publicKey) => {
  try {
    return await timedHorizonCall("loadAccount", () =>
      server.loadAccount(publicKey)
    );
  } catch (error) {
    if (error.response?.status === 404) {
      return null;
    }
    throw error;
  }
};

/**
 * Validate a prospective USDC payment before an unsigned XDR is built, so the
 * wallet is never asked to sign something that will bounce on submission.
 * Only account-not-found is treated as a structured reason; other Horizon
 * errors (network, rate limit) propagate to the caller.
 */
export const preflightPayment = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  memo,
  operationCount = 1,
}) => {
  const reasons = [];
  const warnings = [];

  const [sourceAccount, destinationAccount] = await Promise.all([
    loadAccountOrNull(sourcePublicKey),
    loadAccountOrNull(destinationPublicKey),
  ]);

  if (!sourceAccount) {
    reasons.push({
      code: PREFLIGHT_REASON_CODES.SOURCE_ACCOUNT_MISSING,
      message: "Your Stellar account does not exist or is unfunded on the network.",
    });
  } else {
    const summary = parseAccountSummary(sourceAccount);
    const requiredStroops = toStroops(amount);
    const availableStroops = toStroops(summary.usdcBalance);

    if (availableStroops < requiredStroops) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_BALANCE,
        message: "Your wallet does not hold enough USDC to complete this payment.",
      });
    }

    const minReserveStroops =
      (2n + BigInt(summary.subentryCount)) * BASE_RESERVE_STROOPS;
    const feeStroops = BigInt(StellarSdk.BASE_FEE) * BigInt(operationCount);
    const xlmAvailableStroops = toStroops(summary.xlmBalance);

    if (xlmAvailableStroops < minReserveStroops + feeStroops) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_RESERVE,
        message:
          "Your wallet does not hold enough XLM to cover the minimum reserve and network fee.",
      });
    }
  }

  if (!destinationAccount) {
    reasons.push({
      code: PREFLIGHT_REASON_CODES.DESTINATION_ACCOUNT_MISSING,
      message: "Recipient account does not exist or is unfunded on the network.",
    });
  } else {
    const summary = parseAccountSummary(destinationAccount);

    if (!summary.hasTrustline) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.DESTINATION_NO_TRUSTLINE,
        message:
          "Recipient needs to add a USDC trustline to their wallet before they can receive this payment.",
      });
    }

    if (isMemoRequired(destinationAccount) && !memo) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.DESTINATION_MEMO_REQUIRED,
        message:
          "Recipient requires a memo on incoming payments (SEP-29), commonly the case for exchange or custodial wallets.",
      });
    }
  }

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
  };
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
      server.loadAccount(sourcePublicKey)
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

    const result = await timedHorizonCall("submitTransaction", () =>
      server.submitTransaction(transaction)
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
      if (
        codes.operations?.some(
          (c) =>
            typeof c === "string" &&
            (c.includes("over_sendmax") || c.includes("over_source_max"))
        )
      ) {
        throw new Error("Price moved, request a new quote");
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
      server.transactions().transaction(txHash).call()
    );
    const operations = await timedHorizonCall("fetchOperations", () =>
      server.operations().forTransaction(txHash).call()
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
      return { verified: false, transient: true, reason: "Transaction not found on network" };
    }
    if (!verification.successful) {
      return { verified: false, reason: "Transaction was not successful" };
    }

    const paymentOps = verification.operations.filter((op) => {
      if (op.type === "payment") {
        return (
          op.asset_code === "USDC" && op.asset_issuer === USDC_ISSUER
        );
      }
      if (op.type === "path_payment_strict_receive") {
        return (
          op.destination_asset_code === "USDC" &&
          op.destination_asset_issuer === USDC_ISSUER
        );
      }
      return false;
    });

    for (const expected of expectedPayments) {
      const match = paymentOps.find((op) => {
        if (op.to !== expected.destination) return false;

        const opAmount =
          op.type === "path_payment_strict_receive"
            ? op.destination_amount
            : op.amount;
        return toStroops(opAmount) === toStroops(expected.amount);
      });
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
    return { verified: false, transient: true, reason: "Verification failed" };
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

export {
  server,
  USDC,
  USDC_ISSUER,
  NETWORK,
  networkPassphrase,
  DONATION_WALLET_PUBLIC_KEY,
  PLATFORM_FEE_PERCENT,
  PLATFORM_WALLET_PUBLIC_KEY,
};
