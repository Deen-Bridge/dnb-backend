import Pledge from "../models/Pledge.js";
import PledgeCycle from "../models/PledgeCycle.js";
import { sendNotificationToUser } from "../controllers/notificationController.js";
import { addPledgeCadence } from "../services/pledgeService.js";
import logger from "../config/logger.js";

const INTERVAL_MS = Number(process.env.PLEDGE_SCHEDULER_INTERVAL_MS || 60000);
const WINDOW_MS = Number(process.env.PLEDGE_PAYMENT_WINDOW_MS || 3 * 24 * 60 * 60 * 1000);
let running = false;
let timer = null;

export const tickPledgeScheduler = async (now = new Date()) => {
  const lapsed = await PledgeCycle.find({ status: { $in: ["due", "notified"] }, windowEndsAt: { $lte: now } }).select("pledge");
  if (lapsed.length) {
    const ids = lapsed.map((cycle) => cycle._id);
    await PledgeCycle.updateMany({ _id: { $in: ids } }, { $set: { status: "lapsed" } });
    await Pledge.updateMany({ _id: { $in: lapsed.map((cycle) => cycle.pledge) } }, { $set: { consecutivePaid: 0 } });
  }

  while (true) {
    const pledge = await Pledge.findOneAndUpdate(
      {
        status: "active",
        nextDueAt: { $lte: now },
        $or: [{ schedulerLockUntil: { $exists: false } }, { schedulerLockUntil: { $lte: now } }],
      },
      { $set: { schedulerLockUntil: new Date(now.getTime() + 30000) } },
      { new: true, sort: { nextDueAt: 1 } }
    );
    if (!pledge) break;
    const dueAt = pledge.nextDueAt;
    const nextDueAt = addPledgeCadence(dueAt, pledge);
    try {
      const cycle = await PledgeCycle.findOneAndUpdate(
        { pledge: pledge._id, dueAt },
        { $setOnInsert: { status: "due", windowEndsAt: new Date(dueAt.getTime() + WINDOW_MS) } },
        { upsert: true, new: true }
      );
      if (cycle.status === "due") {
        await sendNotificationToUser(pledge.user, {
          sender: pledge.user,
          type: "pledge_due",
          title: "Your sadaqah pledge is due",
          message: `${pledge.amount} USDC is ready for your signature.`,
          data: { pledgeId: pledge._id, pledgeCycleId: cycle._id },
          priority: "high",
        });
        cycle.status = "notified";
        await cycle.save();
      }
      await Pledge.updateOne({ _id: pledge._id, nextDueAt: dueAt }, { $set: { nextDueAt }, $unset: { schedulerLockUntil: 1 } });
    } catch (error) {
      await Pledge.updateOne({ _id: pledge._id }, { $unset: { schedulerLockUntil: 1 } });
      logger.error({ pledgeId: pledge._id, error: error.message }, "Pledge scheduler tick failed");
      throw error;
    }
  }
};

const loop = async () => {
  if (!running) return;
  try { await tickPledgeScheduler(); } catch (error) { logger.error(error, "Pledge scheduler failed"); }
  timer = setTimeout(loop, INTERVAL_MS);
  timer.unref?.();
};

export const startPledgeScheduler = async () => { if (!running) { running = true; loop(); } };
export const stopPledgeScheduler = async () => { running = false; if (timer) clearTimeout(timer); timer = null; };
