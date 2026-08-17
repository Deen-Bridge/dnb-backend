// services/stellar/stellarService.js
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import { observeHorizonDuration } from "../../config/metrics.js";
import {
  getAssetConfig,
  getRegistry,
  getDefaultAssetCode,
  getSupportedCodes,
} from "../../config/assets.js";

import { client } from "./horizonClient.js";

const NETWORK = process.env.STELLAR_NETWORK || "testnet";
const networkPassphrase =
  NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

// Back-compat: USDC / USDC_ISSUER are now derived from the registry
// instead of being hardcoded, but keep the same exported shape so
// existing callers (and the path-payment flow, out of scope for #60)
// keep working unchanged.
const USDC_CONFIG = getAssetConfig("USDC", NETWORK);
const USDC_ISSUER = USDC_CONFIG.issuer;
const USDC = new StellarSdk.Asset("USDC", USDC_ISSUER);

const DEFAULT_ASSET_CODE = getDefaultAssetCode(NETWORK);

/**
 * Resolve a StellarSdk.Asset instance from a registry asset code.
 * Native assets (issuer === null, e.g. XLM) use Asset.native().
 * Throws a clear error if the code isn't supported on this network.
 */
export const resolveAsset = (assetCode = DEFAULT_ASSET_CODE) => {
  const config = getAssetConfig(assetCode, NETWORK);
  if (!config) {
    throw new Error(
      `Unsupported asset code: ${assetCode}. Supported: ${getSupportedCodes(NETWORK).join(", ")}`
    );
  }
  return config.issuer
    ? new StellarSdk.Asset(config.code, config.issuer)
    : StellarSdk.Asset.native();
};

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

export const toStroops = (amount) => {
  const [whole, frac = ""] = amount.toString().split(".");
  return (
    BigInt(whole || "0") * STROOPS_PER_UNIT +
    BigInt((frac + "0000000").slice(0, 7))
  );
};

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

// NOTE: findPaymentPaths / buildPathPaymentTransaction stay USDC-settled
// on purpose. Issue #60 (this refactor) covers settling natively in any
// registry asset; path-payment settlement into a chosen non-USDC asset is
// issue #27's scope, to avoid duplicating that work.
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

export const buildSep7Uri = ({ destination, amount, memo, assetCode = DEFAULT_ASSET_CODE }) => {
  const config = getAssetConfig(assetCode, NETWORK);
  if (!config) {
    throw new Error(`Unsupported asset code: ${assetCode}`);
  }

  const params = new URLSearchParams({
    destination,
    amount: amount.toString(),
  });

  // Native XLM has no asset_code/asset_issuer in SEP-7 (omission means XLM).
  if (config.issuer) {
    params.set("asset_code", config.code);
    params.set("asset_issuer", config.issuer);
  }

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

/**
 * Summarize an account's XLM balance plus per-asset balances/trustlines
 * for every issued asset in the registry (native XLM is handled
 * separately since it never needs a trustline).
 */
const parseAccountSummary = (account) => {
  const registry = getRegistry(NETWORK);
  const balances = {};
  const trustlines = {};

  for (const [code, cfg] of Object.entries(registry)) {
    if (!cfg.issuer) continue; // native asset, no trustline concept
    const found = account.balances?.find(
      (b) => b.asset_code === cfg.code && b.asset_issuer === cfg.issuer
    );
    balances[code] = found?.balance || "0";
    trustlines[code] = !!found;
  }

  const xlmBalance = account.balances?.find((b) => b.asset_type === "native");

  return {
    xlmBalance: xlmBalance?.balance || "0",
    balances,
    trustlines,
    // Back-compat fields: existing callers expect a single USDC balance
    // and a single hasTrustline flag.
    usdcBalance: balances.USDC || "0",
    hasTrustline: !!trustlines.USDC,
    subentryCount: account.subentry_count ?? 0,
  };
};

export const getAccountBalance = async (publicKey) => {
  try {
    const account = await timedHorizonCall("loadAccount", () =>
      client.execute(server => server.loadAccount(publicKey))
    );
    const summary = parseAccountSummary(account);

    return {
      exists: true,
      xlmBalance: summary.xlmBalance,
      usdcBalance: summary.usdcBalance,
      hasTrustline: summary.hasTrustline,
      balances: summary.balances,
      trustlines: summary.trustlines,
    };
  } catch (error) {
    if (error.response?.status === 404) {
      const registry = getRegistry(NETWORK);
      const balances = {};
      const trustlines = {};
      for (const [code, cfg] of Object.entries(registry)) {
        if (!cfg.issuer) continue;
        balances[code] = "0";
        trustlines[code] = false;
      }
      return {
        exists: false,
        xlmBalance: "0",
        usdcBalance: "0",
        hasTrustline: false,
        balances,
        trustlines,
      };
    }
    logger.error("Error fetching account balance:", error);
    throw error;
  }
};

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
 * Validate a prospective payment before an unsigned XDR is built, so the
 * wallet is never asked to sign something that will bounce on submission.
 * assetCode defaults to the registry default (USDC) for back-compat.
 */
export const preflightPayment = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  memo,
  operationCount = 1,
  assetCode = DEFAULT_ASSET_CODE,
}) => {
  const reasons = [];
  const warnings = [];
  const assetConfig = getAssetConfig(assetCode, NETWORK);

  if (!assetConfig) {
    reasons.push({
      code: "unsupported_asset",
      message: `Asset ${assetCode} is not supported. Supported: ${getSupportedCodes(NETWORK).join(", ")}`,
    });
    return { ok: false, reasons, warnings };
  }

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
    // Native XLM balance being spent is checked against xlmBalance; issued
    // assets (USDC, EURC, ...) are checked against their own balance.
    const availableStroops = assetConfig.issuer
      ? toStroops(summary.balances[assetCode] || "0")
      : toStroops(summary.xlmBalance);

    if (availableStroops < requiredStroops) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.SOURCE_INSUFFICIENT_BALANCE,
        message: `Your wallet does not hold enough ${assetCode} to complete this payment.`,
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
    const hasRequiredTrustline = assetConfig.issuer
      ? !!summary.trustlines[assetCode]
      : true; // native XLM never needs a trustline

    if (!hasRequiredTrustline) {
      reasons.push({
        code: PREFLIGHT_REASON_CODES.DESTINATION_NO_TRUSTLINE,
        message: `Recipient needs to add a ${assetCode} trustline to their wallet before they can receive this payment.`,
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
  assetCode = DEFAULT_ASSET_CODE,
}) => {
  try {
    const asset = resolveAsset(assetCode);
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
            asset,
            amount: feeSplit.creatorAmount,
          })
        )
        .addOperation(
          StellarSdk.Operation.payment({
            destination: feeSplit.platformWallet,
            asset,
            amount: feeSplit.platformAmount,
          })
        );
    } else {
      builder.addOperation(
        StellarSdk.Operation.payment({
          destination: destinationPublicKey,
          asset,
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
      assetCode,
    };
  } catch (error) {
    logger.error("Error building payment transaction:", error);
    throw error;
  }
};

export const buildReversePaymentTransaction = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  originalTxHash,
  assetCode = DEFAULT_ASSET_CODE,
}) => {
  try {
    const asset = resolveAsset(assetCode);
    const sourceAccount = await timedHorizonCall("loadAccount", () =>
      server.loadAccount(sourcePublicKey)
    );

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    builder.addOperation(
      StellarSdk.Operation.payment({
        destination: destinationPublicKey,
        asset,
        amount: amount.toString(),
      })
    );

    const memoText = originalTxHash
      ? `RFND:${originalTxHash.slice(0, 20)}`
      : "DeenBridge Refund";

    const transaction = builder
      .addMemo(StellarSdk.Memo.text(memoText))
      .setTimeout(300)
      .build();

    return {
      xdr: transaction.toXDR(),
      hash: transaction.hash().toString("hex"),
      networkPassphrase,
    };
  } catch (error) {
    logger.error("Error building reverse payment transaction:", error);
    throw error;
  }
};

export const submitTransaction = async (signedXdr) => {
  try {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      networkPassphrase
    );

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
        throw new Error("Insufficient balance");
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
          "Recipient does not have a trustline for this asset. They need to add it to their wallet first."
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

/**
 * Verify that expected payments landed on-chain in the given asset.
 * assetCode defaults to the registry default (USDC) for back-compat.
 */
export const verifyPaymentOperations = async (txHash, expectedPayments, assetCode = DEFAULT_ASSET_CODE) => {
  try {
    const verification = await verifyTransaction(txHash);
    const assetConfig = getAssetConfig(assetCode, NETWORK);

    if (!verification.exists) {
      return { verified: false, transient: true, reason: "Transaction not found on network" };
    }
    if (!verification.successful) {
      return { verified: false, reason: "Transaction was not successful" };
    }

    const matchesAsset = (op, codeField, issuerField, typeField) => {
      if (!assetConfig.issuer) {
        return op[typeField] === "native";
      }
      return op[codeField] === assetConfig.code && op[issuerField] === assetConfig.issuer;
    };

    const paymentOps = verification.operations.filter((op) => {
      if (op.type === "payment") {
        return matchesAsset(op, "asset_code", "asset_issuer", "asset_type");
      }
      if (op.type === "path_payment_strict_receive") {
        return matchesAsset(
          op,
          "destination_asset_code",
          "destination_asset_issuer",
          "destination_asset_type"
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
          reason: `Missing expected ${assetCode} payment of ${expected.amount} to ${expected.destination}`,
        };
      }
    }

    return { verified: true };
  } catch (error) {
    logger.error("Error verifying payment operations:", error);
    return { verified: false, transient: true, reason: "Verification failed" };
  }
};

export const hasTrustline = async (publicKey, assetCode = DEFAULT_ASSET_CODE) => {
  const config = getAssetConfig(assetCode, NETWORK);
  if (!config) return false;
  if (!config.issuer) return true; // native XLM never needs a trustline
  try {
    const balance = await getAccountBalance(publicKey);
    return !!balance.trustlines[assetCode];
  } catch {
    return false;
  }
};

// Thin back-compat wrapper: existing callers use hasUsdcTrustline directly.
export const hasUsdcTrustline = async (publicKey) => hasTrustline(publicKey, "USDC");

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

export const validateSignedPaymentXdr = (xdr) => {
  if (!xdr) return { valid: false, reason: "XDR is required" };
  try {
    const tx = StellarSdk.TransactionBuilder.fromXDR(xdr, networkPassphrase);
    return { valid: true, transaction: tx };
  } catch (err) {
    return { valid: false, reason: err.message };
  }
};

export const server = client.endpoints[0].server;

export {
  USDC,
  USDC_ISSUER,
  NETWORK,
  networkPassphrase,
  DONATION_WALLET_PUBLIC_KEY,
  PLATFORM_FEE_PERCENT,
  PLATFORM_WALLET_PUBLIC_KEY,
  DEFAULT_ASSET_CODE,
};