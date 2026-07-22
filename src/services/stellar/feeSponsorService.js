import * as StellarSdk from "@stellar/stellar-sdk";
import FeeSponsorDailySpend from "../../models/FeeSponsorDailySpend.js";
import logger from "../../config/logger.js";
import {
  server,
  USDC_ISSUER,
  networkPassphrase,
  DONATION_WALLET_PUBLIC_KEY,
  toStroops,
} from "./stellarService.js";

export class FeeSponsorshipError extends Error {
  constructor(message, code, status = 422) {
    super(message);
    this.name = "FeeSponsorshipError";
    this.code = code;
    this.status = status;
  }
}

const positiveInteger = (value, fallback) => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export const getFeeSponsorConfig = () => ({
  enabled: process.env.FEE_SPONSOR_ENABLED === "true",
  maxFeeStroops: positiveInteger(process.env.FEE_SPONSOR_MAX_FEE_STROOPS, 1000000),
  dailyCapStroops: positiveInteger(process.env.FEE_SPONSOR_DAILY_CAP_STROOPS, 10000000),
  perUserDailyLimit: positiveInteger(process.env.FEE_SPONSOR_PER_USER_DAILY_LIMIT, 5),
});

const expectedMemo = (row) =>
  row.type === "donation"
    ? "DNB-SADAQAH"
    : `DNB-${row.itemType.toUpperCase()}-${row.itemId.toString().slice(-8)}`;

const assetMatches = (asset) =>
  asset?.getCode?.() === "USDC" && asset?.getIssuer?.() === USDC_ISSUER;

const sameAmount = (left, right) => {
  try {
    return toStroops(left) === toStroops(right);
  } catch {
    return false;
  }
};

export const validateInnerTransaction = (signedXdr, row) => {
  let transaction;
  try {
    transaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  } catch {
    throw new FeeSponsorshipError("Invalid signed transaction XDR", "invalid_xdr");
  }

  if (transaction.innerTransaction) {
    throw new FeeSponsorshipError("Nested fee-bump transactions are not allowed", "nested_fee_bump");
  }
  if (!transaction.signatures?.length) {
    throw new FeeSponsorshipError("The inner transaction must be signed", "unsigned_transaction");
  }
  if (transaction.source !== row.buyerWallet) {
    throw new FeeSponsorshipError("Transaction source does not match the buyer wallet", "wrong_source");
  }
  const sourceKeypair = StellarSdk.Keypair.fromPublicKey(row.buyerWallet);
  const transactionHash = transaction.hash();
  const hasValidSourceSignature = transaction.signatures.some((signature) =>
    sourceKeypair.verify(transactionHash, signature.signature())
  );
  if (!hasValidSourceSignature) {
    throw new FeeSponsorshipError("The buyer signature is invalid", "invalid_signature");
  }
  if (row.stellarTxHash && transactionHash.toString("hex") !== row.stellarTxHash) {
    throw new FeeSponsorshipError("Signed transaction differs from the initialized transaction", "transaction_changed");
  }

  const expected = row.platformFee?.platformAmount
    ? [
        { destination: row.creatorWallet, amount: row.platformFee.creatorAmount },
        { destination: row.platformFee.platformWallet, amount: row.platformFee.platformAmount },
      ]
    : [{ destination: row.type === "donation" ? DONATION_WALLET_PUBLIC_KEY : row.creatorWallet, amount: row.amount }];

  if (transaction.operations.length !== expected.length) {
    throw new FeeSponsorshipError("Unexpected operation count", "wrong_operation_count");
  }

  transaction.operations.forEach((operation, index) => {
    const wanted = expected[index];
    if (
      operation.type !== "payment" ||
      !assetMatches(operation.asset) ||
      operation.destination !== wanted.destination ||
      !sameAmount(operation.amount, wanted.amount)
    ) {
      throw new FeeSponsorshipError("Transaction contains a non-whitelisted payment", "operation_not_allowed");
    }
  });

  const memoType = transaction.memo?.type ?? transaction.memo?._type;
  const rawMemoValue = transaction.memo?.value ?? transaction.memo?._value;
  const memoValue = Buffer.isBuffer(rawMemoValue) ? rawMemoValue.toString("utf8") : rawMemoValue;
  if (memoType !== "text" || memoValue !== expectedMemo(row)) {
    throw new FeeSponsorshipError("Transaction memo does not match", "wrong_memo");
  }
  return transaction;
};

const sponsorKeypair = () => {
  if (!process.env.FEE_SPONSOR_SECRET) {
    throw new FeeSponsorshipError("Fee sponsorship is not configured", "sponsor_unavailable", 503);
  }
  try {
    return StellarSdk.Keypair.fromSecret(process.env.FEE_SPONSOR_SECRET);
  } catch {
    throw new FeeSponsorshipError("Fee sponsorship is not configured", "sponsor_unavailable", 503);
  }
};

export const wrapWithFeeBump = async (innerTransaction) => {
  const config = getFeeSponsorConfig();
  if (!config.enabled) {
    throw new FeeSponsorshipError("Fee sponsorship is disabled", "sponsorship_disabled", 409);
  }
  const keypair = sponsorKeypair();
  const operationCount = innerTransaction.operations.length + 1;
  const networkBaseFee = positiveInteger(await server.fetchBaseFee(), Number(StellarSdk.BASE_FEE));
  const baseFee = Math.min(networkBaseFee, Math.floor(config.maxFeeStroops / operationCount));
  if (baseFee < Number(StellarSdk.BASE_FEE)) {
    throw new FeeSponsorshipError("Configured fee cap is too low", "fee_cap_too_low", 503);
  }
  const feeBump = StellarSdk.TransactionBuilder.buildFeeBumpTransaction(
    keypair,
    baseFee.toString(),
    innerTransaction,
    networkPassphrase
  );
  feeBump.sign(keypair);
  const reservedStroops = Number(feeBump.fee);
  if (reservedStroops > config.maxFeeStroops) {
    throw new FeeSponsorshipError("Transaction exceeds the sponsorship fee cap", "per_transaction_cap", 429);
  }
  return { feeBump, reservedStroops, innerHash: innerTransaction.hash().toString("hex") };
};

const dateKey = () => new Date().toISOString().slice(0, 10);

export const reserveSponsorship = async (userId, stroops) => {
  const config = getFeeSponsorConfig();
  const userKey = userId.toString().replaceAll(".", "_").replaceAll("$", "_");
  const userPath = `perUser.${userKey}`;
  const filter = {
    dateKey: dateKey(),
    totalStroops: { $lte: config.dailyCapStroops - stroops },
    $or: [{ [userPath]: { $lt: config.perUserDailyLimit } }, { [userPath]: { $exists: false } }],
  };
  try {
    const spend = await FeeSponsorDailySpend.findOneAndUpdate(
      filter,
      { $inc: { totalStroops: stroops, [userPath]: 1 }, $setOnInsert: { dateKey: dateKey() } },
      { new: true, upsert: true }
    );
    if (!spend) throw new Error("cap");
  } catch (error) {
    if (error?.code === 11000 || error.message === "cap") {
      throw new FeeSponsorshipError("Daily sponsorship allowance has been reached", "daily_limit", 429);
    }
    throw error;
  }
  return { dateKey: dateKey(), userPath, stroops };
};

export const releaseSponsorship = async (reservation, actualFee = 0) => {
  if (!reservation) return;
  const release = reservation.stroops - Math.max(0, actualFee);
  const update = { $inc: { totalStroops: -release } };
  if (actualFee === 0) update.$inc[reservation.userPath] = -1;
  await FeeSponsorDailySpend.updateOne({ dateKey: reservation.dateKey }, update);
};

export const prepareSponsoredTransaction = async (signedXdr, row) => {
  const innerTransaction = validateInnerTransaction(signedXdr, row);
  return wrapWithFeeBump(innerTransaction);
};

export const submitPreparedSponsoredTransaction = async (wrapped, row, userId) => {
  let reservation;
  try {
    reservation = await reserveSponsorship(userId, wrapped.reservedStroops);
    const result = await server.submitTransaction(wrapped.feeBump);
    const actualFee = Number(result.fee_charged || wrapped.reservedStroops);
    try {
      await releaseSponsorship(reservation, actualFee);
    } catch (accountingError) {
      // The full reservation remains charged, which is conservative and keeps
      // caps safe. Never tell a client to resubmit an already accepted payment.
      logger.error("Failed to reconcile sponsored fee reservation", {
        transactionId: row._id?.toString(),
        message: accountingError.message,
      });
    }
    logger.info("Fee sponsorship accepted", { transactionId: row._id?.toString(), feeStroops: actualFee });
    return {
      hash: result.hash,
      ledger: result.ledger,
      successful: result.successful,
      feeCharged: actualFee,
      innerHash: wrapped.innerHash,
    };
  } catch (error) {
    // Once Horizon submission has been attempted the outcome may be ambiguous.
    // Keep the full reservation charged; reconciliation can safely under-count
    // neither an accepted transaction nor its fee.
    logger.warn("Fee sponsorship rejected", { transactionId: row._id?.toString(), code: error.code || "submission_failed" });
    if (error instanceof FeeSponsorshipError) throw error;
    throw new FeeSponsorshipError("Sponsored submission failed; submit normally instead", "sponsored_submission_failed", 422);
  }
};

export const submitSponsoredTransaction = async (signedXdr, row, userId) => {
  const wrapped = await prepareSponsoredTransaction(signedXdr, row);
  return submitPreparedSponsoredTransaction(wrapped, row, userId);
};

export const reconcileSponsoredTransaction = async (innerHash) => {
  const keypair = sponsorKeypair();
  try {
    const page = await server
      .transactions()
      .forAccount(keypair.publicKey())
      .order("desc")
      .limit(200)
      .call();
    const transaction = page.records.find(
      (record) =>
        record.inner_transaction_hash === innerHash ||
        record.innerTransactionHash === innerHash
    );
    if (!transaction) return null;
    return {
      hash: transaction.hash,
      ledger: transaction.ledger,
      successful: transaction.successful,
      feeCharged: Number(transaction.fee_charged || transaction.feeCharged || 0),
      innerHash,
      reconciled: true,
    };
  } catch (error) {
    logger.warn("Unable to reconcile sponsored transaction", {
      innerHash,
      message: error.message,
    });
    return null;
  }
};

export const getFeeSponsorStatus = async () => {
  const config = getFeeSponsorConfig();
  if (!config.enabled) return { enabled: false };
  const keypair = sponsorKeypair();
  const [account, spend] = await Promise.all([
    server.loadAccount(keypair.publicKey()),
    FeeSponsorDailySpend.findOne({ dateKey: dateKey() }).lean(),
  ]);
  const native = account.balances.find((balance) => balance.asset_type === "native");
  return {
    enabled: true,
    sponsorAccount: keypair.publicKey(),
    nativeBalance: native?.balance || "0",
    spentTodayStroops: spend?.totalStroops || 0,
    dailyCapStroops: config.dailyCapStroops,
    perUserDailyLimit: config.perUserDailyLimit,
  };
};
