import * as StellarSdk from "@stellar/stellar-sdk";
import { server, USDC, networkPassphrase, getAccountBalance } from "./stellarService.js";

/**
 * Builds an unsigned transaction to create a claimable balance.
 *
 * @param {Object} params
 * @param {string} params.sourcePublicKey - Payer's public key
 * @param {string} params.claimantPublicKey - Recipient's public key
 * @param {string} params.amount - Amount in decimal string
 * @param {Date|number|string} params.expiresAt - Expiry date/time
 * @returns {Promise<{xdr: string, hash: string, networkPassphrase: string}>}
 */
export const buildCreateClaimableBalanceTx = async ({
  sourcePublicKey,
  claimantPublicKey,
  amount,
  expiresAt,
}) => {
  const sourceAccount = await server.loadAccount(sourcePublicKey);
  const expiresTimestamp = Math.floor(new Date(expiresAt).getTime() / 1000);

  const recipientClaimant = new StellarSdk.Claimant(
    claimantPublicKey,
    StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresTimestamp.toString())
  );

  const senderClaimant = new StellarSdk.Claimant(
    sourcePublicKey,
    StellarSdk.Claimant.predicateNot(
      StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresTimestamp.toString())
    )
  );

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });

  builder.addOperation(
    StellarSdk.Operation.createClaimableBalance({
      asset: USDC,
      amount: amount.toString(),
      claimants: [recipientClaimant, senderClaimant],
    })
  );

  const transaction = builder.setTimeout(300).build();

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString("hex"),
    networkPassphrase,
  };
};

/**
 * Builds an unsigned transaction to claim a claimable balance.
 * Automatically adds a changeTrust operation if the claimant lacks a USDC trustline.
 *
 * @param {Object} params
 * @param {string} params.claimantPublicKey - The public key of the claimant (recipient or sender)
 * @param {string} params.balanceId - The ID of the claimable balance
 * @returns {Promise<{xdr: string, hash: string, networkPassphrase: string}>}
 */
export const buildClaimTx = async ({ claimantPublicKey, balanceId }) => {
  const sourceAccount = await server.loadAccount(claimantPublicKey);
  const balance = await getAccountBalance(claimantPublicKey);

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });

  // Prepend changeTrust if the claimant lacks a USDC trustline
  if (!balance.hasTrustline) {
    builder.addOperation(
      StellarSdk.Operation.changeTrust({
        asset: USDC,
      })
    );
  }

  builder.addOperation(
    StellarSdk.Operation.claimClaimableBalance({
      balanceId,
    })
  );

  const transaction = builder.setTimeout(300).build();

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString("hex"),
    networkPassphrase,
  };
};

/**
 * Retrieves the claimable balance ID from a confirmed transaction.
 *
 * I chose to parse the transaction effects (which Horizon extracts from the result XDR)
 * instead of using the `forClaimant` query.
 * Reason: `forClaimant` is susceptible to race conditions and ambiguity if a sender
 * makes multiple identical gifts to the same claimant. Parsing the effects of the specific
 * transaction is deterministic and guarantees we get the exact balance ID created by that transaction.
 *
 * @param {string} txHash
 * @returns {Promise<string>}
 */
export const resolveBalanceId = async (txHash) => {
  const effects = await server.effects().forTransaction(txHash).call();
  const creationEffect = effects.records.find(
    (eff) => eff.type === "claimable_balance_created"
  );

  if (!creationEffect || !creationEffect.balance_id) {
    throw new Error("No claimable balance created in this transaction");
  }

  return creationEffect.balance_id;
};

/**
 * Retrieves a claimable balance by its ID for live status checks.
 *
 * @param {string} balanceId
 * @returns {Promise<Object>}
 */
export const getClaimableBalance = async (balanceId) => {
  return await server.claimableBalances().claimableBalance(balanceId).call();
};
