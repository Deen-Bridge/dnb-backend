import IngestionCursor from "../models/IngestionCursor.js";
import { client } from "../services/stellar/horizonClient.js";
import { USDC_ISSUER } from "../services/stellar/stellarService.js";
import { reconcilePayment } from "../services/stellar/reconciliationService.js";
import logger from "../config/logger.js";

const POLL_INTERVAL_MS = parseInt(process.env.INGESTION_POLL_INTERVAL_MS || "30000", 10);
const PAGE_LIMIT = 200;

let running = false;
let pollTimer = null;

const WATCHED_ACCOUNTS = () => {
  const accounts = [];
  const platformWallet = process.env.PLATFORM_WALLET_PUBLIC_KEY;
  const donationWallet = process.env.DONATION_WALLET_PUBLIC_KEY;
  if (platformWallet) accounts.push(platformWallet);
  if (donationWallet) accounts.push(donationWallet);
  return accounts;
};

const fetchParentTransaction = async (server, txHash) => {
  try {
    return await server.transactions().transaction(txHash).call();
  } catch {
    return null;
  }
};

const isUsdcPayment = (record) => {
  if (record.type === "payment") {
    return record.asset_code === "USDC" && record.asset_issuer === USDC_ISSUER;
  }
  if (record.type === "path_payment_strict_receive") {
    return record.destination_asset_code === "USDC" && record.destination_asset_issuer === USDC_ISSUER;
  }
  return false;
};

const processAccount = async (account, server) => {
  let cursorDoc = await IngestionCursor.findOne({ account });
  if (!cursorDoc) {
    cursorDoc = await IngestionCursor.create({ account, cursor: "" });
  }

  const savedCursor = cursorDoc.cursor;
  let records;
  try {
    const paymentsCall = server
      .payments()
      .forAccount(account)
      .order("asc")
      .limit(PAGE_LIMIT);

    if (savedCursor) {
      paymentsCall.cursor(savedCursor);
    }

    records = await paymentsCall.call();
  } catch (error) {
    logger.error({ account, error: error.message }, "Failed to fetch payments for account");
    return;
  }

  if (!records?.records?.length) {
    await IngestionCursor.updateOne(
      { account },
      { $set: { lastSyncAt: new Date() } }
    );
    return;
  }

  const usdcPayments = records.records.filter(isUsdcPayment);

  for (const payment of usdcPayments) {
    try {
      const txRecord = await fetchParentTransaction(server, payment.transaction_hash);
      await reconcilePayment(payment, txRecord);
    } catch (error) {
      logger.error(
        { txHash: payment.transaction_hash, error: error.message },
        "Error processing payment record"
      );
    }
  }

  const lastRecord = records.records[records.records.length - 1];
  const newCursor = lastRecord.paging_token;

  await IngestionCursor.updateOne(
    { account },
    { $set: { cursor: newCursor, lastSyncAt: new Date() } }
  );

  logger.info(
    { account, cursor: newCursor, usdcProcessed: usdcPayments.length, totalRecords: records.records.length },
    "Account ingestion page complete"
  );
};

const ingestionLoop = async (server) => {
  if (!running) return;

  const accounts = WATCHED_ACCOUNTS();
  if (accounts.length === 0) {
    logger.warn("No watched accounts configured (PLATFORM_WALLET_PUBLIC_KEY / DONATION_WALLET_PUBLIC_KEY)");
    return;
  }

  for (const account of accounts) {
    await processAccount(account, server);
  }

  pollTimer = setTimeout(() => ingestionLoop(server), POLL_INTERVAL_MS);
  if (pollTimer && typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }
};

export const startIngestionWorker = async () => {
  if (running) return;
  running = true;

  const server = client.endpoints[0].server;
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Payment ingestion worker started");
  ingestionLoop(server);
};

export const stopIngestionWorker = async () => {
  running = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  logger.info("Payment ingestion worker stopped");
};
