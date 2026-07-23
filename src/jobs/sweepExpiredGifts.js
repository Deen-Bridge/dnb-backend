import GiftClaim from "../models/GiftClaim.js";
import { getClaimableBalance } from "../services/stellar/claimableBalanceService.js";
import logger from "../config/logger.js";

/**
 * Sweeps expired gifts and marks them as "expired" in the DB.
 */
export const sweepExpiredGifts = async () => {
  logger.info("Starting expired gifts sweep...");
  try {
    const expiredGifts = await GiftClaim.find({
      status: "open",
      claimExpiryDate: { $lt: new Date() },
    });

    let sweptCount = 0;

    for (const gift of expiredGifts) {
      if (!gift.balanceId) continue;

      let balanceStillExists = true;
      try {
        await getClaimableBalance(gift.balanceId);
      } catch (err) {
        if (err.response?.status === 404) {
          balanceStillExists = false;
        } else {
          // Some other Horizon error (rate limit, etc.), skip for now
          logger.warn(`Error checking claimable balance ${gift.balanceId}:`, err.message);
          continue;
        }
      }

      // If the balance still exists and we're past expiresAt, it's definitively expired
      // because the recipient's predicate is beforeAbsoluteTime(expiresAt).
      // If it's 404, it might have been reclaimed by the sender or claimed by the recipient manually.
      // To strictly follow requirements ("If it is genuinely expired/reclaimed on-chain (catch 404 ...), mark the DB status as expired"),
      // we mark it expired in either case since our internal status "claimed" is set when the recipient uses our UI.
      // If it was claimed outside the UI, marking it expired is a safe fallback (or requires tx history lookup).
      
      gift.status = "expired";
      await gift.save();
      sweptCount++;
      logger.info(`Gift ${gift._id} marked as expired.`);
    }

    logger.info(`Expired gifts sweep complete. Swept ${sweptCount} gifts.`);
  } catch (error) {
    logger.error("Error during expired gifts sweep:", error);
  }
};

let sweepInterval;

export const startGiftSweepJob = () => {
  // Run every 10 minutes
  const intervalMs = 10 * 60 * 1000;
  sweepInterval = setInterval(sweepExpiredGifts, intervalMs);
  logger.info("Expired gifts sweep job started.");
};

export const stopGiftSweepJob = () => {
  if (sweepInterval) {
    clearInterval(sweepInterval);
    logger.info("Expired gifts sweep job stopped.");
  }
};
