import mongoose from "mongoose";

import Pledge from "../models/Pledge.js";
import PledgeCycle from "../models/PledgeCycle.js";

const STROOPS_PER_UNIT = 10000000n;
const toStroops = (amount) => {
  const [whole, fraction = ""] = amount.toString().split(".");
  return BigInt(whole || "0") * STROOPS_PER_UNIT + BigInt((fraction + "0000000").slice(0, 7));
};

const DAY_MS = 24 * 60 * 60 * 1000;

export const addPledgeCadence = (date, pledge) => {
  const source = new Date(date);
  if (pledge.cadence === "daily") return new Date(source.getTime() + DAY_MS);
  if (pledge.cadence === "weekly") return new Date(source.getTime() + 7 * DAY_MS);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(pledge.anchorDate || source.getUTCDate(), lastDay);
  return new Date(Date.UTC(year, month, day, source.getUTCHours(), source.getUTCMinutes(), source.getUTCSeconds(), source.getUTCMilliseconds()));
};

export const firstDueAt = ({ cadence, anchorDay, anchorDate, startAt = new Date() }) => {
  const start = new Date(startAt);
  if (cadence === "daily") return start;
  if (cadence === "weekly") {
    const target = anchorDay ?? start.getUTCDay();
    const delta = (target - start.getUTCDay() + 7) % 7;
    return new Date(start.getTime() + delta * DAY_MS);
  }
  const target = anchorDate ?? start.getUTCDate();
  const lastDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  if (start.getUTCDate() <= Math.min(target, lastDay)) {
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), Math.min(target, lastDay), start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
  }
  return addPledgeCadence(start, { cadence, anchorDate: target });
};

export const markPledgeTransactionPaid = async (transaction, paidAt = new Date()) => {
  if (!mongoose.Types.ObjectId.isValid(transaction?._id)) return null;
  const cycle = await PledgeCycle.findOne({ transaction: transaction._id, status: { $ne: "paid" } });
  if (!cycle) return null;
  cycle.status = "paid";
  await cycle.save();
  const pledge = await Pledge.findById(cycle.pledge);
  if (!pledge) return cycle;
  const consecutivePaid = pledge.consecutivePaid + 1;
  pledge.consecutivePaid = consecutivePaid;
  pledge.longestStreak = Math.max(pledge.longestStreak, consecutivePaid);
  pledge.totalPaidStroops = (BigInt(pledge.totalPaidStroops || "0") + toStroops(transaction.amount)).toString();
  pledge.lastPaidAt = paidAt;
  await pledge.save();
  return cycle;
};
