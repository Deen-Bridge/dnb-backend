import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import IngestionCursor from "../models/IngestionCursor.js";
import { client } from "../services/stellar/horizonClient.js";
import { USDC_ISSUER } from "../services/stellar/stellarService.js";
import { reconcilePayment } from "../services/stellar/reconciliationService.js";
import {
  INGESTION_ERROR_CODES,
  listWatchedAccounts,
  resolveLeaseMs,
  resolvePollIntervalMs,
} from "../services/stellar/ingestionConfig.js";
import { recordIngestionPoll } from "../config/metrics.js";
import logger from "../config/logger.js";

const PAGE_LIMIT = 200;

// Identifies this process on the lease it renews. Stored on the cursor for
// debugging only; the status endpoint never returns it.
const WORKER_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString("hex")}`;

let running = false;
let pollTimer = null;

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

/** Map a Horizon failure to a bounded code; the message stays in the logs. */
const classifyHorizonError = (error) => {
  const status = error?.response?.status ?? error?.status;
  if (status === 429) return INGESTION_ERROR_CODES.HORIZON_RATE_LIMITED;
  if (
    (typeof status === "number" && status >= 500) ||
    ["ECONNABORTED", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND"].includes(error?.code)
  ) {
    return INGESTION_ERROR_CODES.HORIZON_UNAVAILABLE;
  }
  return INGESTION_ERROR_CODES.HORIZON_ERROR;
};

const leaseFields = (now) => ({
  lastPollAt: now,
  workerId: WORKER_ID,
  leaseExpiresAt: new Date(now.getTime() + resolveLeaseMs()),
});

const recordPollFailure = (account, errorCode) => {
  const now = new Date();
  return IngestionCursor.updateOne(
    { account },
    {
      $set: { ...leaseFields(now), lastErrorAt: now, lastErrorCode: errorCode },
      $inc: { consecutiveFailures: 1 },
    }
  );
};

const processAccount = async ({ account, role }, server) => {
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
    const errorCode = classifyHorizonError(error);
    logger.error({ account, errorCode, error: error.message }, "Failed to fetch payments for account");
    // The cursor stays where it was; only the failure and heartbeat move.
    await recordPollFailure(account, errorCode);
    recordIngestionPoll(role, "failed");
    return;
  }

  const now = new Date();
  const success = { ...leaseFields(now), lastSyncAt: now, lastSuccessAt: now, consecutiveFailures: 0 };

  if (!records?.records?.length) {
    await IngestionCursor.updateOne({ account }, { $set: success });
    recordIngestionPoll(role, "success");
    return;
  }

  const usdcPayments = records.records.filter(isUsdcPayment);
  let failedPayments = 0;

  for (const payment of usdcPayments) {
    try {
      const txRecord = await fetchParentTransaction(server, payment.transaction_hash);
      await reconcilePayment(payment, txRecord);
    } catch (error) {
      failedPayments += 1;
      logger.error(
        { txHash: payment.transaction_hash, error: error.message },
        "Error processing payment record"
      );
    }
  }

  const lastRecord = records.records[records.records.length - 1];
  const newCursor = lastRecord.paging_token;

  // Horizon is reachable and the cursor advances, so the poll itself counts
  // as a success; a payment that failed to reconcile is still surfaced as the
  // account's last error so it is visible on the status endpoint.
  await IngestionCursor.updateOne(
    { account },
    {
      $set: {
        ...success,
        cursor: newCursor,
        ...(failedPayments > 0 && {
          lastErrorAt: new Date(),
          lastErrorCode: INGESTION_ERROR_CODES.RECONCILE_FAILED,
        }),
      },
    }
  );
  recordIngestionPoll(role, failedPayments > 0 ? "partial" : "success");

  logger.info(
    {
      account,
      cursor: newCursor,
      usdcProcessed: usdcPayments.length,
      failedPayments,
      totalRecords: records.records.length,
    },
    "Account ingestion page complete"
  );
};

const ingestionLoop = async (server) => {
  if (!running) return;

  const accounts = listWatchedAccounts();
  if (accounts.length === 0) {
    logger.warn("No watched accounts configured (PLATFORM_WALLET_PUBLIC_KEY / DONATION_WALLET_PUBLIC_KEY)");
    return;
  }

  for (const watched of accounts) {
    try {
      await processAccount(watched, server);
    } catch (error) {
      // A database error used to reject the loop and silently stop all
      // polling. Log it, try to leave a trace on the cursor, and carry on.
      logger.error({ account: watched.account, error: error.message }, "Ingestion poll failed");
      recordIngestionPoll(watched.role, "failed");
      try {
        await recordPollFailure(watched.account, INGESTION_ERROR_CODES.PERSISTENCE_ERROR);
      } catch (recordError) {
        logger.error(
          { account: watched.account, error: recordError.message },
          "Could not record ingestion failure on cursor"
        );
      }
    }
  }

  if (!running) return;
  pollTimer = setTimeout(() => ingestionLoop(server), resolvePollIntervalMs());
  if (pollTimer && typeof pollTimer.unref === "function") {
    pollTimer.unref();
  }
};

export const startIngestionWorker = async () => {
  if (running) return;
  running = true;

  const server = client.endpoints[0].server;
  logger.info({ intervalMs: resolvePollIntervalMs(), workerId: WORKER_ID }, "Payment ingestion worker started");
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
