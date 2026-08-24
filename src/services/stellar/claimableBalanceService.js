// services/stellar/claimableBalanceService.js
//
// Stellar claimable balances for gifting courses/books and trustline-free
// receiving. The sender creates an on-ledger USDC balance the recipient can
// claim whenever they're ready, with a reclaim-after-expiry predicate so
// funds are never stranded:
//
//   - recipient claimant: predicateBeforeAbsoluteTime(expiresAt)
//   - sender claimant:    predicateNot(predicateBeforeAbsoluteTime(expiresAt))
//
// All signing stays client-side; this service only builds unsigned XDR,
// resolves the REAL claimable-balance id after inclusion, verifies on-chain,
// and lets the controller grant access to the recipient.
//
// The #1 trap this module exists to avoid: the claimable-balance id is NOT
// the transaction hash. It is the hex-encoded XDR of the ClaimableBalanceId
// produced by the create_claimable_balance operation result.

import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import { client } from "./horizonClient.js";
import {
  server,
  networkPassphrase,
  USDC,
  USDC_ISSUER,
  toStroops,
  hasUsdcTrustline,
} from "./stellarService.js";

/** How long a gifted balance stays claimable before the sender can reclaim. */
export const GIFT_EXPIRY_DAYS = 30;
export const giftExpiryFromNow = () =>
  new Date(Date.now() + GIFT_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

/**
 * Build an unsigned transaction that creates a USDC claimable balance for the
 * recipient, with the sender as the reclaim-after-expiry claimant.
 * @returns {Promise<{xdr: string, hash: string, networkPassphrase: string, expiresAt: Date}>}
 */
export const buildCreateClaimableBalanceTx = async ({
  sourcePublicKey,
  claimantPublicKey,
  amount,
  expiresAt,
  memo = "DeenBridge Gift",
}) => {
  const sourceAccount = await client.execute((srv) =>
    srv.loadAccount(sourcePublicKey)
  );

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });

  builder.addOperation(
    StellarSdk.Operation.createClaimableBalance({
      asset: USDC,
      amount: amount.toString(),
      claimants: [
        // Recipient can claim up until the expiry instant.
        new StellarSdk.Claimant(
          claimantPublicKey,
          StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresAt)
        ),
        // Sender can reclaim once the expiry instant has passed — strictly
        // complementary predicates, so there is no window where neither (or
        // both) can claim.
        new StellarSdk.Claimant(
          sourcePublicKey,
          StellarSdk.Claimant.predicateNot(
            StellarSdk.Claimant.predicateBeforeAbsoluteTime(expiresAt)
          )
        ),
      ],
    })
  );

  const transaction = builder
    .addMemo(StellarSdk.Memo.text(memo))
    .setTimeout(300)
    .build();

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString("hex"),
    networkPassphrase,
    expiresAt,
  };
};

/**
 * Build an unsigned claim transaction for a claimable balance. When the
 * claimant has no USDC trustline yet, a changeTrust(USDC) operation is
 * prepended IN THE SAME TRANSACTION so claiming is a single signature —
 * this is the trustline-free receiving path.
 * @returns {Promise<{xdr: string, hash: string, networkPassphrase: string, includesChangeTrust: boolean}>}
 */
export const buildClaimTx = async ({ claimantPublicKey, balanceId }) => {
  const includesChangeTrust = !(await hasUsdcTrustline(claimantPublicKey));
  const sourceAccount = await client.execute((srv) =>
    srv.loadAccount(claimantPublicKey)
  );

  const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  });

  if (includesChangeTrust) {
    builder.addOperation(StellarSdk.Operation.changeTrust({ asset: USDC }));
  }
  builder.addOperation(
    StellarSdk.Operation.claimClaimableBalance({ balanceId })
  );

  const transaction = builder.setTimeout(300).build();

  return {
    xdr: transaction.toXDR(),
    hash: transaction.hash().toString("hex"),
    networkPassphrase,
    includesChangeTrust,
  };
};

/**
 * Resolve the REAL claimable-balance id for a create transaction.
 *
 * Primary path: parse the transaction result XDR
 * (CreateClaimableBalanceResult → balanceId). This is deterministic and
 * immune to races — unlike querying Horizon by claimant, which is ambiguous
 * when the same account has created several balances.
 *
 * Fallback: when the result XDR is unavailable (e.g. Horizon lag), query
 * `claimableBalances().forClaimant(source)` and match the amount/asset.
 *
 * @param {string} createTxHash - hash of the create_claimable_balance tx
 * @param {object} [opts] - { amount, claimantPublicKey } to disambiguate the fallback
 * @returns {Promise<string|null>} the balance id (hex XDR), or null
 */
export const resolveBalanceId = async (
  createTxHash,
  { amount, claimantPublicKey } = {}
) => {
  // Primary: parse the operation result from the transaction result XDR.
  try {
    const tx = await client.execute((srv) =>
      srv.transactions().transaction(createTxHash).call()
    );
    if (tx?.result_xdr) {
      const result = StellarSdk.xdr.TransactionResult.fromXDR(
        tx.result_xdr,
        "base64"
      );
      const operationResults = result.result().results() || [];
      for (const opResult of operationResults) {
        const createResult = opResult.tr().createClaimableBalanceResult();
        if (createResult && createResult.balanceId()) {
          const balanceId = createResult.balanceId().toXDR("hex");
          if (balanceId && balanceId !== createTxHash) {
            return balanceId;
          }
        }
      }
    }
  } catch (error) {
    logger.warn(
      { createTxHash, err: error.message },
      "resolveBalanceId: could not parse transaction result XDR, falling back to Horizon query"
    );
  }

  // Fallback: query by the balance's sponsor (the create tx source account).
  try {
    let sourceAccount;
    if (claimantPublicKey) {
      sourceAccount = claimantPublicKey;
    } else {
      const tx = await client.execute((srv) =>
        srv.transactions().transaction(createTxHash).call()
      );
      sourceAccount = tx?.source_account;
    }
    if (!sourceAccount) return null;

    const page = await client.execute((srv) =>
      srv.claimableBalances().forClaimant(sourceAccount).call()
    );
    const records = page?.records || [];
    const match = records.find((r) => {
      // Horizon encodes the asset as "CODE:ISSUER" on claimable balances.
      const assetIsUsdc =
        typeof r.asset === "string" && r.asset.startsWith("USDC:");
      if (!assetIsUsdc) return false;
      if (amount != null && toStroops(r.amount) !== toStroops(amount)) {
        return false;
      }
      return true;
    });
    return match?.id || null;
  } catch (error) {
    logger.warn(
      { createTxHash, err: error.message },
      "resolveBalanceId: fallback Horizon query failed"
    );
    return null;
  }
};

/**
 * Look up a claimable balance on Horizon for live status/predicate checks.
 * @returns {Promise<{exists: boolean, record?: object}>}
 */
export const getClaimableBalance = async (balanceId) => {
  try {
    const record = await client.execute((srv) =>
      srv.claimableBalances().claimableBalance(balanceId).call()
    );
    return { exists: true, record };
  } catch (error) {
    if (error.response?.status === 404) {
      return { exists: false };
    }
    logger.error("Error fetching claimable balance:", error);
    throw error;
  }
};

/**
 * Decode a claim predicate XDR into a plain, comparable shape.
 * @returns {{type: string, time?: string, seconds?: string, children?: Array}}
 */
export const describePredicate = (pred) => {
  const name = pred?._switch?.name;
  switch (name) {
    case "claimPredicateUnconditional":
      return { type: "unconditional" };
    case "claimPredicateAnd":
      return { type: "and", children: (pred._value || []).map(describePredicate) };
    case "claimPredicateOr":
      return { type: "or", children: (pred._value || []).map(describePredicate) };
    case "claimPredicateNot":
      return { type: "not", child: describePredicate(pred._value) };
    case "claimPredicateBeforeAbsoluteTime":
      return { type: "before_absolute_time", time: String(pred._value?._value ?? "") };
    case "claimPredicateBeforeRelativeTime":
      return { type: "before_relative_time", seconds: String(pred._value?._value ?? "") };
    default:
      return { type: "unknown", name };
  }
};

/**
 * Validate a signed gift XDR against the expected create_claimable_balance
 * before ANY database write or access grant. Mirrors the discipline of
 * validateSignedPaymentXdr (stellarService.js): a tampered XDR (wrong asset,
 * wrong amount, or altered claimants/predicates) is rejected outright.
 *
 * @param {string} signedXdr
 * @param {{assetCode?: string, amount: string, recipientWallet: string, senderWallet: string, expiresAt: Date|string|number}} expected
 * @returns {object} the parsed transaction
 */
export const validateSignedGiftXdr = (signedXdr, expected) => {
  const {
    assetCode = "USDC",
    amount,
    recipientWallet,
    senderWallet,
    expiresAt,
  } = expected;

  const tx = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  const giftOps = tx.operations.filter(
    (op) => op.type === "createClaimableBalance"
  );
  if (giftOps.length === 0) {
    throw new Error(
      "Signed XDR missing a create_claimable_balance operation"
    );
  }
  const op = giftOps[0];

  const assetMatches =
    (op.asset?.code === assetCode && op.asset?.issuer === USDC_ISSUER) ||
    (op.asset_type === "credit_alphanum4" &&
      op.asset?.code === assetCode &&
      op.asset?.issuer === USDC_ISSUER);
  if (!assetMatches) {
    throw new Error(
      `Signed XDR create_claimable_balance uses the wrong asset (expected ${assetCode})`
    );
  }

  if (toStroops(op.amount) !== toStroops(amount)) {
    throw new Error(
      `Signed XDR create_claimable_balance amount mismatch (expected ${amount})`
    );
  }

  const expectedTime = String(new Date(expiresAt).getTime());
  const claimants = (op.claimants || []).map((c) => ({
    destination: c.destination,
    predicate: describePredicate(c.predicate),
  }));

  const recipientClaimant = claimants.find(
    (c) => c.destination === recipientWallet
  );
  const recipientPredicateOk =
    recipientClaimant?.predicate.type === "before_absolute_time" &&
    recipientClaimant.predicate.time === expectedTime;
  if (!recipientPredicateOk) {
    throw new Error(
      "Signed XDR missing the recipient claimant with before_absolute_time(expiresAt)"
    );
  }

  const senderClaimant = claimants.find((c) => c.destination === senderWallet);
  const senderPredicateOk =
    senderClaimant?.predicate.type === "not" &&
    senderClaimant.predicate.child?.type === "before_absolute_time" &&
    senderClaimant.predicate.child.time === expectedTime;
  if (!senderPredicateOk) {
    throw new Error(
      "Signed XDR missing the sender claimant with not(before_absolute_time(expiresAt))"
    );
  }

  return tx;
};

export { server };
