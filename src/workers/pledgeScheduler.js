import Pledge from "../models/Pledge.js";
import PledgeCycle from "../models/PledgeCycle.js";
import { sendNotificationToUser } from "../controllers/notificationController.js";
import logger from "../config/logger.js";
import { toStroops } from "../services/stellar/stellarService.js";

const DEFAULT_WINDOW_HOURS = 48;

export const computeNextDueAt = (fromDate, cadence, anchorDay = 1) => {
  const date = new Date(fromDate);
  const utcDate = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0));

  if (cadence === "daily") {
    utcDate.setUTCDate(utcDate.getUTCDate() + 1);
    return utcDate;
  }

  if (cadence === "weekly") {
    utcDate.setUTCDate(utcDate.getUTCDate() + 7);
    return utcDate;
  }

  const targetDay = Math.min(anchorDay || 1, 28);
  const year = utcDate.getUTCFullYear();
  const month = utcDate.getUTCMonth();
  const nextMonth = month + 1;
  const nextMonthDate = new Date(Date.UTC(year, nextMonth, 1, 12, 0, 0));
  const daysInMonth = new Date(Date.UTC(year, nextMonth + 1, 0)).getUTCDate();
  const day = Math.min(targetDay, daysInMonth);
  nextMonthDate.setUTCDate(day);
  return nextMonthDate;
};

export const processDuePledges = async () => {
  const now = new Date();
  const duePledges = await Pledge.find({
    status: "active",
    nextDueAt: { $lte: now },
  }).lean();

  for (const pledge of duePledges) {
    const nextDueAt = computeNextDueAt(pledge.nextDueAt, pledge.cadence, pledge.anchorDay);
    const cycle = await PledgeCycle.findOneAndUpdate(
      { pledge: pledge._id, dueAt: pledge.nextDueAt },
      {
        $setOnInsert: {
          pledge: pledge._id,
          dueAt: pledge.nextDueAt,
          windowEndsAt: new Date(pledge.nextDueAt.getTime() + DEFAULT_WINDOW_HOURS * 60 * 60 * 1000),
          status: "due",
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const updatedPledge = await Pledge.findOneAndUpdate(
      { _id: pledge._id, nextDueAt: pledge.nextDueAt },
      { $set: { nextDueAt } },
      { new: true }
    );

    if (updatedPledge && cycle) {
      await sendNotificationToUser(pledge.user, {
        sender: pledge.user,
        type: "pledge_due",
        title: "Pledge due",
        message: `Your recurring sadaqah pledge for ${pledge.amount} USDC is due. Please sign to complete it.`,
        priority: "medium",
        data: { pledgeId: pledge._id, cycleId: cycle._id },
      });
    }
  }

  return { created: duePledges.length };
};

export const markLapsedCycles = async () => {
  const now = new Date();
  const cycles = await PledgeCycle.find({ status: { $in: ["due", "notified"] }, windowEndsAt: { $lte: now } }).lean();
  for (const cycle of cycles) {
    await PledgeCycle.updateOne({ _id: cycle._id }, { $set: { status: "lapsed" } });
    await Pledge.updateOne({ _id: cycle.pledge }, { $set: { consecutivePaid: 0 } });
  }
};

export const startPledgeScheduler = () => {
  if (process.env.PLEDGE_SCHEDULER_ENABLED !== "true") {
    return null;
  }

  logger.info("Starting pledge scheduler");
  return setInterval(() => {
    processDuePledges().catch((error) => logger.error(error, "Pledge scheduler error"));
    markLapsedCycles().catch((error) => logger.error(error, "Pledge lapse processing error"));
  }, 5 * 60 * 1000);
};

export const stopPledgeScheduler = (timer) => {
  if (timer) clearInterval(timer);
};
