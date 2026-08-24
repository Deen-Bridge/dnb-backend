import mongoose from "mongoose";
import Pledge from "../../models/Pledge.js";
import PledgeCycle from "../../models/PledgeCycle.js";
import { isValidPublicKey } from "../../services/stellar/stellarService.js";
import {
  createDonationIntent,
  validateDonationAmount,
} from "../../services/stellar/donationIntentService.js";
import { firstDueAt } from "../../services/pledgeService.js";
import { submitDonation } from "./donationController.js";

export const createPledge = async (req, res) => {
  const { publicKey, amount, cadence, anchorDay, anchorDate, startAt } = req.body;
  if (!isValidPublicKey(publicKey || "")) {
    return res.status(400).json({ success: false, message: "Invalid Stellar public key" });
  }
  if (!validateDonationAmount(amount)) {
    return res.status(400).json({ success: false, message: "Invalid amount. Must be positive with at most 7 decimal places" });
  }
  if (!["daily", "weekly", "monthly"].includes(cadence)) {
    return res.status(400).json({ success: false, message: "Cadence must be daily, weekly, or monthly" });
  }
  if (cadence === "weekly" && anchorDay !== undefined && (!Number.isInteger(anchorDay) || anchorDay < 0 || anchorDay > 6)) {
    return res.status(400).json({ success: false, message: "anchorDay must be between 0 and 6" });
  }
  if (cadence === "monthly" && anchorDate !== undefined && (!Number.isInteger(anchorDate) || anchorDate < 1 || anchorDate > 31)) {
    return res.status(400).json({ success: false, message: "anchorDate must be between 1 and 31" });
  }
  const effectiveStart = startAt ? new Date(startAt) : new Date();
  if (Number.isNaN(effectiveStart.getTime())) {
    return res.status(400).json({ success: false, message: "Invalid startAt" });
  }
  const pledge = await Pledge.create({
    user: req.user._id,
    publicKey,
    amount: amount.toString(),
    cadence,
    anchorDay: cadence === "weekly" ? (anchorDay ?? effectiveStart.getUTCDay()) : undefined,
    anchorDate: cadence === "monthly" ? (anchorDate ?? effectiveStart.getUTCDate()) : undefined,
    nextDueAt: firstDueAt({ cadence, anchorDay, anchorDate, startAt: effectiveStart }),
  });
  res.status(201).json({ success: true, pledge });
};

export const listPledges = async (req, res) => {
  const pledges = await Pledge.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.json({ success: true, pledges });
};

export const getPledgeStats = async (req, res) => {
  const pledges = await Pledge.find({ user: req.user._id }).lean();
  const totals = pledges.reduce(
    (stats, pledge) => {
      stats.totalPaidStroops = (BigInt(stats.totalPaidStroops) + BigInt(pledge.totalPaidStroops || "0")).toString();
      stats.longestStreak = Math.max(stats.longestStreak, pledge.longestStreak || 0);
      stats.active += pledge.status === "active" ? 1 : 0;
      return stats;
    },
    { totalPaidStroops: "0", longestStreak: 0, active: 0 }
  );
  res.json({ success: true, ...totals, pledges });
};

export const updatePledgeStatus = async (req, res) => {
  const { status } = req.body;
  if (!["active", "paused", "cancelled"].includes(status)) {
    return res.status(400).json({ success: false, message: "Invalid pledge status" });
  }
  const pledge = await Pledge.findOne({ _id: req.params.id, user: req.user._id });
  if (!pledge) return res.status(404).json({ success: false, message: "Pledge not found" });
  if (pledge.status === "cancelled" && status !== "cancelled") {
    return res.status(409).json({ success: false, message: "Cancelled pledges cannot be resumed" });
  }
  pledge.status = status;
  await pledge.save();
  res.json({ success: true, pledge });
};

export const listPledgeCycles = async (req, res) => {
  const pledge = await Pledge.findOne({ _id: req.params.id, user: req.user._id });
  if (!pledge) return res.status(404).json({ success: false, message: "Pledge not found" });
  const cycles = await PledgeCycle.find({ pledge: pledge._id }).sort({ dueAt: -1 }).populate("transaction");
  res.json({ success: true, cycles });
};

export const initializePledgeCycle = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const cycle = await PledgeCycle.findById(req.params.cycleId).session(session);
    if (!cycle || !["due", "notified"].includes(cycle.status)) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Payable pledge cycle not found" });
    }
    const pledge = await Pledge.findOne({ _id: cycle.pledge, user: req.user._id, status: { $ne: "cancelled" } }).session(session);
    if (!pledge) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Pledge not found" });
    }
    if (cycle.windowEndsAt <= new Date()) {
      cycle.status = "lapsed";
      pledge.consecutivePaid = 0;
      await Promise.all([cycle.save({ session }), pledge.save({ session })]);
      await session.commitTransaction();
      return res.status(410).json({ success: false, message: "Pledge cycle payment window has ended" });
    }
    if (cycle.transaction) {
      const transaction = await cycle.populate("transaction");
      await session.abortTransaction();
      return res.status(409).json({ success: false, message: "Pledge cycle already initialized", donationId: transaction.transaction?._id });
    }
    const intent = await createDonationIntent({
      donorId: req.user._id,
      publicKey: pledge.publicKey,
      amount: pledge.amount,
      session,
      memo: "DNB-PLEDGE",
    });
    cycle.transaction = intent.transaction._id;
    await cycle.save({ session });
    await session.commitTransaction();
    res.json({
      success: true,
      cycleId: cycle._id,
      donationId: intent.transaction._id,
      transactionXdr: intent.transactionXdr,
      sep7Uri: intent.sep7Uri,
      networkPassphrase: intent.networkPassphrase,
    });
  } catch (error) {
    await session.abortTransaction();
    res.status(error.statusCode || 500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const submitPledgeCycle = async (req, res) => {
  const cycle = await PledgeCycle.findById(req.params.cycleId).populate("pledge");
  if (!cycle || !cycle.pledge || cycle.pledge.user.toString() !== req.user._id.toString() || !cycle.transaction) {
    return res.status(404).json({ success: false, message: "Initialized pledge cycle not found" });
  }
  req.body.donationId = cycle.transaction.toString();
  return submitDonation(req, res);
};
