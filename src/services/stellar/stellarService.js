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
 * @returns {Promise<Object>} - Transaction XDR and hash
 */
export const buildPaymentTransaction = async ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
  memo,
}) => {
  try {
    const sourceAccount = await server.loadAccount(sourcePublicKey);

    const transaction = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        StellarSdk.Operation.payment({
          destination: destinationPublicKey,
          asset: USDC,
          amount: amount.toString(),
        })
      )
      .addMemo(StellarSdk.Memo.text(memo || "DeenBridge Purchase"))
      .setTimeout(300) // 5 minutes
      .build();

    return {
      xdr: transaction.toXDR(),
      hash: transaction.hash().toString("hex"),
      networkPassphrase,
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

export { server, USDC, USDC_ISSUER, NETWORK, networkPassphrase };
