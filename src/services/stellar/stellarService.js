// services/stellar/stellarService.js
import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";

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

// USDC Asset Identifiers
// Testnet: Use a test USDC issuer
// Mainnet: Circle's official USDC issuer
const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN" // Circle USDC on mainnet
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"; // Testnet USDC issuer

const USDC = new StellarSdk.Asset("USDC", USDC_ISSUER);

// Sadaqah donation fund wallet (public key only, never a secret key)
const DONATION_WALLET_PUBLIC_KEY = process.env.DONATION_WALLET_PUBLIC_KEY || "";

// Platform fee configuration (0-20 percent, default 0 = disabled)
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

// Stellar amounts have exactly 7 decimal places (1 unit = 10,000,000 stroops)
const STROOPS_PER_UNIT = 10000000n;

/**
 * Convert a decimal amount (string or number) to stroops (BigInt, 7 decimals)
 * @param {string|number} amount - The amount to convert
 * @returns {BigInt} - Amount in stroops
 */
const toStroops = (amount) => {
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
const fromStroops = (stroops) => {
  const whole = stroops / STROOPS_PER_UNIT;
  const frac = (stroops % STROOPS_PER_UNIT)
    .toString()
    .padStart(7, "0")
    .replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
};

/**
 * Calculate the creator/platform split for a payment amount.
 * Uses integer (stroop) math for exact 7-decimal precision: the platform
 * share is floored, so any rounding remainder goes to the creator and the
 * two amounts always sum exactly to the original amount.
 * @param {string|number} amount - The full payment amount
 * @param {number} [feePercent] - Fee percent (defaults to PLATFORM_FEE_PERCENT)
 * @param {string} [platformWallet] - Platform wallet (defaults to PLATFORM_WALLET_PUBLIC_KEY)
 * @returns {Object|null} - { creatorAmount, platformAmount, feePercent, platformWallet } or null when no fee applies
 */
export const calculateFeeSplit = (
  amount,
  feePercent = PLATFORM_FEE_PERCENT,
  platformWallet = PLATFORM_WALLET_PUBLIC_KEY
) => {
  if (!feePercent || feePercent <= 0 || !platformWallet) {
    return null;
  }

  const totalStroops = toStroops(amount);
  // Basis points keep fractional percents (e.g. 2.5) exact in integer math
  const feeBasisPoints = BigInt(Math.round(feePercent * 100));
  const platformStroops = (totalStroops * feeBasisPoints) / 10000n; // floor
  const creatorStroops = totalStroops - platformStroops;

  // A fee that rounds down to zero stroops would be an invalid payment op
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

/**
 * Build a SEP-7 payment URI (web+stellar:pay) for wallet deep-linking
 * @param {Object} params - URI parameters
 * @param {string} params.destination - Recipient's public key
 * @param {string|number} params.amount - Amount of USDC
 * @param {string} [params.memo] - Optional text memo
 * @returns {string} - SEP-7 payment URI
 */
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

/**
 * Validate a Stellar public key
 * @param {string} publicKey - The public key to validate
 * @returns {boolean} - True if valid
 */
export const isValidPublicKey = (publicKey) => {
  try {
    StellarSdk.Keypair.fromPublicKey(publicKey);
    return true;
  } catch {
    return false;
  }
};

/**
 * Get account details including USDC balance
 * @param {string} publicKey - The account's public key
 * @returns {Promise<Object>} - Account info with balances
 */
export const getAccountBalance = async (publicKey) => {
  try {
    const account = await server.loadAccount(publicKey);
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

/**
 * Build a payment transaction (unsigned)
 * This returns the XDR for the frontend to sign with the user's wallet
 * @param {Object} params - Transaction parameters
 * @param {string} params.sourcePublicKey - Sender's public key
 * @param {string} params.destinationPublicKey - Recipient's public key
 * @param {string} params.amount - Amount to send
 * @param {string} params.memo - Optional memo
 * @param {boolean} [params.applyPlatformFee] - Split the amount between the
 *   destination and the platform wallet when a platform fee is configured
 * @returns {Promise<Object>} - Transaction XDR, hash and fee split (null when no fee applies)
 */
export const buildPaymentTransaction = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  memo,
  applyPlatformFee = false,
}) => {
  try {
    const sourceAccount = await server.loadAccount(sourcePublicKey);

    const feeSplit = applyPlatformFee ? calculateFeeSplit(amount) : null;

    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    if (feeSplit) {
      // Atomic split: creator and platform paid in ONE transaction
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
      .setTimeout(300) // 5 minutes
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

/**
 * Submit a signed transaction to the Stellar network
 * @param {string} signedXdr - The signed transaction XDR
 * @returns {Promise<Object>} - Submission result
 */
export const submitTransaction = async (signedXdr) => {
  try {
    const transaction = StellarSdk.TransactionBuilder.fromXDR(
      signedXdr,
      networkPassphrase
    );

    const result = await server.submitTransaction(transaction);
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful,
    };
  } catch (error) {
    logger.error("Error submitting transaction:", error);

    // Parse Stellar error for better messages
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

/**
 * Verify a transaction was successful on the Stellar network
 * @param {string} txHash - The transaction hash
 * @returns {Promise<Object>} - Verification result
 */
export const verifyTransaction = async (txHash) => {
  try {
    const tx = await server.transactions().transaction(txHash).call();
    const operations = await server.operations().forTransaction(txHash).call();

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
 * Verify that a confirmed transaction contains the expected USDC payment
 * operations (amount + destination + asset). Used after submission to make
 * sure the signed transaction actually paid who it was supposed to pay.
 * @param {string} txHash - The transaction hash
 * @param {Array<{destination: string, amount: string|number}>} expectedPayments - Payments that must exist
 * @returns {Promise<Object>} - { verified, reason }
 */
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

/**
 * Check if an account has a USDC trustline
 * @param {string} publicKey - The account's public key
 * @returns {Promise<boolean>} - True if trustline exists
 */
export const hasUsdcTrustline = async (publicKey) => {
  try {
    const balance = await getAccountBalance(publicKey);
    return balance.hasTrustline;
  } catch (error) {
    return false;
  }
};

/**
 * Get the explorer URL for a transaction
 * @param {string} txHash - The transaction hash
 * @returns {string} - Explorer URL
 */
export const getExplorerUrl = (txHash) => {
  const baseUrl =
    NETWORK === "mainnet"
      ? "https://stellar.expert/explorer/public/tx/"
      : "https://stellar.expert/explorer/testnet/tx/";
  return baseUrl + txHash;
};

/**
 * Get the explorer URL for an account
 * @param {string} publicKey - The account's public key
 * @returns {string} - Explorer URL
 */
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
