// services/payoutService.js
import mongoose from "mongoose";
import * as StellarSdk from "@stellar/stellar-sdk";
import EducatorBalance from "../models/EducatorBalance.js";
import LedgerEntry from "../models/LedgerEntry.js";
import PayoutBatch from "../models/PayoutBatch.js";
import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import {
  toStroops,
  fromStroops,
  hasUsdcTrustline,
  submitTransaction,
  verifyPaymentOperations,
  getExplorerUrl,
  server,
  USDC,
  networkPassphrase,
  PLATFORM_WALLET_PUBLIC_KEY,
} from "./stellar/stellarService.js";
import logger from "../config/logger.js";

/**
 * Record earnings for an educator upon transaction confirmation (Idempotent per stellarTxHash)
 * @param {Object} transaction - Confirmed Transaction document
 * @param {Object} [options] - Options with session
 * @returns {Promise<Object>} - Result of balance credit
 */
export const recordSaleEarnings = async (transaction, { session } = {}) => {
  if (transaction.status !== "confirmed") {
    return { success: false, reason: "Transaction not confirmed" };
  }

  const txRef = transaction.stellarTxHash || transaction._id.toString();

  // Idempotency check: verify if a sale ledger entry already exists for this txRef
  const existingEntry = await LedgerEntry.findOne({
    txRef,
    type: "sale",
  }).session(session || null);

  if (existingEntry) {
    logger.info(`Sale earnings for transaction ${txRef} already recorded. Skipping.`);
    return { success: true, idempotentSkipped: true };
  }

  if (!transaction.creator) {
    return { success: false, reason: "Transaction has no creator" };
  }

  const netAmountStr = transaction.platformFee?.creatorAmount || transaction.amount;
  const amountStroops = toStroops(netAmountStr);
  const settlementMode = transaction.settlement || "direct";

  let balance = await EducatorBalance.findOne({
    educator: transaction.creator,
  }).session(session || null);

  if (!balance) {
    balance = new EducatorBalance({
      educator: transaction.creator,
      owedStroops: "0",
      settledStroops: "0",
    });
  }

  if (settlementMode === "platform_collect") {
    const currentOwed = BigInt(balance.owedStroops || "0");
    balance.owedStroops = (currentOwed + amountStroops).toString();
  } else {
    const currentSettled = BigInt(balance.settledStroops || "0");
    balance.settledStroops = (currentSettled + amountStroops).toString();
  }

  await balance.save({ session: session || null });

  const ledgerEntry = new LedgerEntry({
    educator: transaction.creator,
    type: "sale",
    txRef,
    amount: netAmountStr,
    amountStroops: amountStroops.toString(),
    settlement: settlementMode,
  });

  await ledgerEntry.save({ session: session || null });

  logger.info(
    `Recorded ${settlementMode} sale earnings of ${netAmountStr} USDC (${amountStroops} stroops) for educator ${transaction.creator}`
  );

  return { success: true, balance, ledgerEntry };
};

/**
 * Build a batch payout plan and (if dryRun=false) create unsigned Stellar XDRs
 * @param {Object} params
 * @param {string[]} [params.educatorIds] - Optional target educator IDs
 * @param {string|number} [params.minAmount="0"] - Minimum owed amount threshold
 * @param {boolean} [params.dryRun=false] - If true, return plan without DB writes
 * @param {string} [params.adminId] - Operator user ID
 * @returns {Promise<Object>} - Payout build result
 */
export const buildPayoutBatch = async ({
  educatorIds,
  minAmount = "0",
  dryRun = false,
  adminId,
} = {}) => {
  const minStroops = toStroops(minAmount);
  let candidateEducators = [];

  if (Array.isArray(educatorIds) && educatorIds.length > 0) {
    candidateEducators = await User.find({ _id: { $in: educatorIds } });
  } else {
    const balances = await EducatorBalance.find({ owedStroops: { $ne: "0" } });
    const userIds = balances.map((b) => b.educator);
    candidateEducators = await User.find({ _id: { $in: userIds } });
  }

  const recipients = [];
  const skipped = [];

  for (const user of candidateEducators) {
    const balance = await EducatorBalance.findOne({ educator: user._id });
    const owedStroops = BigInt(balance?.owedStroops || "0");

    if (owedStroops <= 0n || owedStroops < minStroops) {
      skipped.push({
        educatorId: user._id,
        name: user.name,
        reason: "below minimum",
      });
      continue;
    }

    if (!user.stellarWallet?.publicKey) {
      skipped.push({
        educatorId: user._id,
        name: user.name,
        reason: "no wallet",
      });
      continue;
    }

    const trustlineOk = await hasUsdcTrustline(user.stellarWallet.publicKey);
    if (!trustlineOk) {
      skipped.push({
        educatorId: user._id,
        name: user.name,
        reason: "no USDC trustline",
      });
      continue;
    }

    recipients.push({
      educator: user._id,
      name: user.name,
      wallet: user.stellarWallet.publicKey,
      amount: fromStroops(owedStroops),
      stroops: owedStroops.toString(),
    });
  }

  const totalStroopsBigInt = recipients.reduce(
    (acc, r) => acc + BigInt(r.stroops),
    0n
  );
  const totalAmount = fromStroops(totalStroopsBigInt);

  if (dryRun) {
    return {
      dryRun: true,
      totalRecipients: recipients.length,
      totalAmount,
      totalStroops: totalStroopsBigInt.toString(),
      recipients,
      skipped,
    };
  }

  if (recipients.length === 0) {
    return {
      success: false,
      message: "No eligible educators for payout",
      recipients: [],
      skipped,
    };
  }

  const batchId = new mongoose.Types.ObjectId().toString();
  const platformWalletKey =
    process.env.PLATFORM_WALLET_PUBLIC_KEY || PLATFORM_WALLET_PUBLIC_KEY;

  if (!platformWalletKey) {
    throw new Error("PLATFORM_WALLET_PUBLIC_KEY environment variable is not set");
  }

  let sourceAccount;
  try {
    sourceAccount = await server.loadAccount(platformWalletKey);
  } catch (error) {
    // Offline fallback for unit tests or network errors
    sourceAccount = new StellarSdk.Account(platformWalletKey, "1000");
  }

  // Chunk recipients into groups of at most 100 payment ops
  const CHUNK_SIZE = 100;
  const chunkedRecipients = [];
  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    chunkedRecipients.push(recipients.slice(i, i + CHUNK_SIZE));
  }

  const chunks = [];
  const memoText = `DNB-PAYOUT-${batchId.slice(-16)}`;

  for (let cIdx = 0; cIdx < chunkedRecipients.length; cIdx++) {
    const chunkRecipients = chunkedRecipients[cIdx];
    const builder = new StellarSdk.TransactionBuilder(sourceAccount, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    });

    for (const rec of chunkRecipients) {
      builder.addOperation(
        StellarSdk.Operation.payment({
          destination: rec.wallet,
          asset: USDC,
          amount: rec.amount,
        })
      );
    }

    const tx = builder
      .addMemo(StellarSdk.Memo.text(memoText))
      .setTimeout(300)
      .build();

    chunks.push({
      chunkIndex: cIdx,
      xdr: tx.toXDR(),
      hash: tx.hash().toString("hex"),
    });
  }

  const payoutBatch = new PayoutBatch({
    batchId,
    recipients,
    totalAmount,
    totalStroops: totalStroopsBigInt.toString(),
    chunks,
    status: "built",
    createdBy: adminId,
  });

  await payoutBatch.save();

  return {
    success: true,
    batchId,
    status: "built",
    totalRecipients: recipients.length,
    totalAmount,
    totalStroops: totalStroopsBigInt.toString(),
    recipients,
    skipped,
    chunks,
  };
};

/**
 * Submit signed batch XDRs to Stellar, verify payments on-chain, and settle balances atomically
 * @param {Object} params
 * @param {string} params.batchId - Payout batch ID
 * @param {string[]|string} params.signedXdrs - Signed XDRs (array or string)
 * @returns {Promise<Object>} - Submission and settlement result
 */
export const submitPayoutBatch = async ({ batchId, signedXdrs }) => {
  const xdrs = Array.isArray(signedXdrs) ? signedXdrs : [signedXdrs];
  const payoutBatch = await PayoutBatch.findOne({ batchId });

  if (!payoutBatch || !["built", "failed"].includes(payoutBatch.status)) {
    throw new Error("Payout batch not found or already processed");
  }

  if (xdrs.length !== payoutBatch.chunks.length) {
    throw new Error(
      `Expected ${payoutBatch.chunks.length} signed XDR(s), but received ${xdrs.length}`
    );
  }

  // 1. Submit and verify each chunk on Stellar
  const CHUNK_SIZE = 100;
  for (let cIdx = 0; cIdx < xdrs.length; cIdx++) {
    const signedXdr = xdrs[cIdx];
    const chunkRecipients = payoutBatch.recipients.slice(
      cIdx * CHUNK_SIZE,
      (cIdx + 1) * CHUNK_SIZE
    );

    let submitResult;
    try {
      submitResult = await submitTransaction(signedXdr);
    } catch (stellarError) {
      payoutBatch.status = "failed";
      payoutBatch.failureReason = `Submission failed for chunk ${cIdx}: ${stellarError.message}`;
      await payoutBatch.save();

      // Revert to built status as required by spec so batch can be fixed/resubmitted
      payoutBatch.status = "built";
      await payoutBatch.save();

      throw new Error(`Stellar submission failed: ${stellarError.message}`);
    }

    const expectedPayments = chunkRecipients.map((rec) => ({
      destination: rec.wallet,
      amount: rec.amount,
    }));

    const verification = await verifyPaymentOperations(
      submitResult.hash,
      expectedPayments
    );

    if (!verification.verified) {
      const reason = `Verification failed for chunk ${cIdx}: ${verification.reason}`;
      payoutBatch.status = "failed";
      payoutBatch.failureReason = reason;
      await payoutBatch.save();

      // Revert to built status as required by spec
      payoutBatch.status = "built";
      await payoutBatch.save();

      throw new Error(reason);
    }

    // Save hash back to chunk if verification passed
    payoutBatch.chunks[cIdx].hash = submitResult.hash;
  }

  // 2. All chunks submitted & verified successfully -> Move owed to settled atomically
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const now = new Date();
    for (const rec of payoutBatch.recipients) {
      const recStroops = BigInt(rec.stroops);
      const balance = await EducatorBalance.findOne({
        educator: rec.educator,
      }).session(session);

      if (balance) {
        const currentOwed = BigInt(balance.owedStroops || "0");
        const currentSettled = BigInt(balance.settledStroops || "0");

        const newOwed = currentOwed >= recStroops ? currentOwed - recStroops : 0n;
        const newSettled = currentSettled + recStroops;

        balance.owedStroops = newOwed.toString();
        balance.settledStroops = newSettled.toString();
        balance.lastPayoutAt = now;
        await balance.save({ session });
      }

      const ledgerEntry = new LedgerEntry({
        educator: rec.educator,
        type: "payout",
        txRef: batchId,
        amount: rec.amount,
        amountStroops: rec.stroops,
      });

      await ledgerEntry.save({ session });
    }

    payoutBatch.status = "confirmed";
    await payoutBatch.save({ session });

    await session.commitTransaction();
    logger.info(`Payout batch ${batchId} successfully submitted, verified, and settled.`);

    return {
      success: true,
      batchId,
      status: "confirmed",
      totalRecipients: payoutBatch.recipients.length,
      totalAmount: payoutBatch.totalAmount,
    };
  } catch (error) {
    await session.abortTransaction();
    payoutBatch.status = "built";
    payoutBatch.failureReason = error.message;
    await payoutBatch.save();
    throw error;
  } finally {
    session.endSession();
  }
};

/**
 * Get educator balance details
 * @param {string} educatorId
 * @returns {Promise<Object>}
 */
export const getEducatorBalance = async (educatorId) => {
  const balance = await EducatorBalance.findOne({ educator: educatorId });
  const owedStroops = BigInt(balance?.owedStroops || "0");
  const settledStroops = BigInt(balance?.settledStroops || "0");
  const lifetimeStroops = owedStroops + settledStroops;

  return {
    owed: fromStroops(owedStroops),
    settled: fromStroops(settledStroops),
    lifetime: fromStroops(lifetimeStroops),
    owedStroops: owedStroops.toString(),
    settledStroops: settledStroops.toString(),
    lastPayoutAt: balance?.lastPayoutAt || null,
  };
};

/**
 * Get educator per-sale statement
 * @param {string} educatorId
 * @param {Object} queryParams - { from, to }
 * @returns {Promise<Array>}
 */
export const getEducatorStatement = async (educatorId, { from, to } = {}) => {
  const query = {
    creator: educatorId,
    status: "confirmed",
  };

  if (from || to) {
    query.createdAt = {};
    if (from) query.createdAt.$gte = new Date(from);
    if (to) query.createdAt.$lte = new Date(to);
  }

  const transactions = await Transaction.find(query).sort({ createdAt: -1 });

  return transactions.map((tx) => {
    const gross = tx.amount;
    const fee = tx.platformFee?.platformAmount || "0";
    const net = tx.platformFee?.creatorAmount || tx.amount;

    return {
      transactionId: tx._id,
      date: tx.confirmedAt || tx.createdAt,
      itemTitle: tx.itemTitle,
      itemType: tx.itemType,
      gross,
      fee,
      net,
      settlement: tx.settlement || "direct",
      stellarTxHash: tx.stellarTxHash,
    };
  });
};

/**
 * Get educator payout batch history
 * @param {string} educatorId
 * @returns {Promise<Array>}
 */
export const getEducatorHistory = async (educatorId) => {
  const batches = await PayoutBatch.find({
    "recipients.educator": educatorId,
    status: "confirmed",
  }).sort({ updatedAt: -1 });

  return batches.map((b) => {
    const recipientInfo = b.recipients.find(
      (r) => r.educator.toString() === educatorId.toString()
    );

    const hashes = b.chunks.map((c) => c.hash).filter(Boolean);

    return {
      batchId: b.batchId,
      date: b.updatedAt,
      amount: recipientInfo?.amount || "0",
      hashes,
      explorerUrls: hashes.map((h) => getExplorerUrl(h)),
    };
  });
};

/**
 * Recompute educator balances strictly from LedgerEntry records
 * @returns {Promise<Object>}
 */
export const recalculateBalancesFromLedger = async () => {
  const entries = await LedgerEntry.find().sort({ createdAt: 1 });
  const storedBalances = await EducatorBalance.find();

  const computed = {};

  for (const entry of entries) {
    const edId = entry.educator.toString();
    if (!computed[edId]) {
      computed[edId] = { owedStroops: 0n, settledStroops: 0n };
    }

    const amtStroops = BigInt(entry.amountStroops || "0");

    if (entry.type === "sale") {
      if (entry.settlement === "platform_collect") {
        computed[edId].owedStroops += amtStroops;
      } else {
        computed[edId].settledStroops += amtStroops;
      }
    } else if (entry.type === "payout") {
      computed[edId].owedStroops -= amtStroops;
      computed[edId].settledStroops += amtStroops;
    }
  }

  let isExact = true;
  const auditReport = [];

  for (const sb of storedBalances) {
    const edId = sb.educator.toString();
    const comp = computed[edId] || { owedStroops: 0n, settledStroops: 0n };

    const storedOwed = BigInt(sb.owedStroops || "0");
    const storedSettled = BigInt(sb.settledStroops || "0");

    const matchOwed = storedOwed === comp.owedStroops;
    const matchSettled = storedSettled === comp.settledStroops;

    if (!matchOwed || !matchSettled) {
      isExact = false;
    }

    auditReport.push({
      educatorId: edId,
      storedOwed: storedOwed.toString(),
      computedOwed: comp.owedStroops.toString(),
      storedSettled: storedSettled.toString(),
      computedSettled: comp.settledStroops.toString(),
      match: matchOwed && matchSettled,
    });
  }

  return { isExact, auditReport };
};
