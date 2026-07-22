// jobs/anchorPoller.js
import AnchorTransaction from "../models/AnchorTransaction.js";
import {
  getAnchorInfo,
  getStoredAnchorJwt,
  fetchAnchorTransactionStatus,
  mapAnchorTransactionFields,
  ANCHOR_TERMINAL_STATUSES,
} from "../services/stellar/anchorService.js";
import logger from "../config/logger.js";

const POLL_TICK_MS = 5000; // how often the poller wakes up to look for due records
const POLL_REFRESH_MS = 15000; // re-check interval for a non-terminal record after a successful poll
const POLL_BACKOFF_BASE_MS = 5000;
const POLL_BACKOFF_MAX_ATTEMPTS = 6; // caps exponential growth

let pollTimer;
let accepting = true;
let inFlight = Promise.resolve();

const backoffDelay = (attempt) => {
  const capped = Math.min(attempt, POLL_BACKOFF_MAX_ATTEMPTS);
  const exponential = POLL_BACKOFF_BASE_MS * 2 ** Math.max(0, capped - 1);
  return exponential + Math.floor(Math.random() * Math.max(1, exponential * 0.2));
};

/**
 * Atomically claim the next due, non-terminal record by pushing its
 * nextPollAt forward immediately. This is what makes the poller restart-safe
 * and safe under concurrent ticks/instances without a separate lock field:
 * there is no in-memory queue to lose on restart, every tick reads state
 * fresh from the DB, and the atomic findOneAndUpdate prevents two ticks (or
 * two processes) from claiming the same record.
 */
const claimDueRecord = async () => {
  const now = new Date();
  return AnchorTransaction.findOneAndUpdate(
    { status: { $nin: ANCHOR_TERMINAL_STATUSES }, nextPollAt: { $lte: now } },
    { $set: { nextPollAt: new Date(now.getTime() + POLL_REFRESH_MS) } },
    { sort: { nextPollAt: 1 }, new: true }
  );
};

const refreshRecord = async (record) => {
  try {
    const jwtToken = await getStoredAnchorJwt(record.user.toString(), record.homeDomain);
    if (!jwtToken) {
      // No live anchor session to poll with (expired/never authenticated).
      // Back off without treating it as an anchor-side error.
      await AnchorTransaction.updateOne(
        { _id: record._id },
        {
          $set: { nextPollAt: new Date(Date.now() + backoffDelay(record.pollAttempts + 1)) },
          $inc: { pollAttempts: 1 },
        }
      );
      return;
    }

    const anchorInfo = await getAnchorInfo(record.homeDomain);
    const tx = await fetchAnchorTransactionStatus({
      transferServer: anchorInfo.transferServer,
      jwtToken,
      anchorTransactionId: record.anchorTransactionId,
    });

    Object.assign(record, mapAnchorTransactionFields(tx));
    record.lastPolledAt = new Date();
    record.pollAttempts = 0;
    record.lastError = undefined;
    // Terminal statuses are excluded from claimDueRecord's query going
    // forward, so nextPollAt no longer matters once one is reached.
    record.nextPollAt = new Date(Date.now() + POLL_REFRESH_MS);
    await record.save();
  } catch (error) {
    const attempts = record.pollAttempts + 1;
    await AnchorTransaction.updateOne(
      { _id: record._id },
      {
        $set: {
          lastError: error.message,
          nextPollAt: new Date(Date.now() + backoffDelay(attempts)),
        },
        $inc: { pollAttempts: 1 },
      }
    );
    logger.warn(
      { anchorTransactionId: record.anchorTransactionId, attempts, error: error.message },
      "Anchor transaction poll failed, backing off"
    );
  }
};

// Exported so tests can drive a single poll cycle deterministically instead
// of waiting on the real setInterval cadence.
export const tick = async () => {
  if (!accepting) return;
  const record = await claimDueRecord();
  if (!record) return;
  await refreshRecord(record);
};

export const startAnchorPoller = () => {
  if (pollTimer) return;
  accepting = true;
  pollTimer = setInterval(() => {
    inFlight = tick().catch((error) => logger.error(error, "Anchor poller tick failed"));
  }, POLL_TICK_MS);
  pollTimer.unref?.();
  logger.info("Anchor transaction poller started");
};

export const stopAnchorPoller = async () => {
  accepting = false;
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = undefined;
  await inFlight.catch(() => {});
};
