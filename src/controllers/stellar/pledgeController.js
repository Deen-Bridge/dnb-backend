import mongoose from "mongoose";
import Pledge from "../../models/Pledge.js";
import PledgeCycle from "../../models/PledgeCycle.js";
import Transaction from "../../models/Transaction.js";
import { isValidPublicKey, buildPaymentTransaction, buildSep7Uri, submitTransaction, verifyPaymentOperations, validateSignedPaymentXdr, NETWORK, DONATION_WALLET_PUBLIC_KEY, toStroops, fromStroops } from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";
import { sendNotificationToUser } from "../notificationController.js";
import { paymentsInitialized, paymentsSubmitted, paymentsConfirmed, paymentsFailed } from "../../config/metrics.js";

const PLEDGE_MEMO_PREFIX = "DNB-SADAQAH-P";

const validatePledgeAmount = (amount) => {
  const parsedAmount = Number(amount);
  return !!amount && Number.isFinite(parsedAmount) && parsedAmount > 0 && /^\d+(\.\d{1,7})?$/.test(amount.toString());
};

const buildPledgeMemo = (pledgeId) => {
  const shortId = pledgeId.toString().slice(-6);
  return `${PLEDGE_MEMO_PREFIX}${shortId}`;
};

export const createPledge = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const userId = req.user._id;
    const { publicKey, amount, cadence, anchorDay } = req.body;

    if (!publicKey || !isValidPublicKey(publicKey)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Invalid Stellar public key" });
    }
    if (!validatePledgeAmount(amount)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Invalid amount. Must be a positive number with at most 7 decimal places" });
    }
    if (!['daily', 'weekly', 'monthly'].includes(cadence)) {
      await session.abortTransaction();
      return res.status(400).json({ success: false, message: "Invalid cadence" });
    }

    const nextDueAt = new Date(Date.now());
    const pledge = await Pledge.create([{ user: userId, publicKey, amount: amount.toString(), cadence, anchorDay, nextDueAt, status: 'active' }], { session });

    await session.commitTransaction();
    res.status(201).json({ success: true, pledge: pledge[0] });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Create pledge error", error);
    res.status(500).json({ success: false, message: "Failed to create pledge" });
  } finally {
    session.endSession();
  }
};

export const pausePledge = async (req, res) => {
  const { pledgeId } = req.params;
  const pledge = await Pledge.findOne({ _id: pledgeId, user: req.user._id });
  if (!pledge) return res.status(404).json({ success: false, message: "Pledge not found" });
  if (pledge.status === "cancelled") return res.status(400).json({ success: false, message: "Cancelled pledges cannot be paused" });
  pledge.status = "paused";
  await pledge.save();
  res.status(200).json({ success: true, pledge });
};

export const resumePledge = async (req, res) => {
  const { pledgeId } = req.params;
  const pledge = await Pledge.findOne({ _id: pledgeId, user: req.user._id });
  if (!pledge) return res.status(404).json({ success: false, message: "Pledge not found" });
  if (pledge.status === "cancelled") return res.status(400).json({ success: false, message: "Cancelled pledges cannot be resumed" });
  pledge.status = "active";
  await pledge.save();
  res.status(200).json({ success: true, pledge });
};

export const cancelPledge = async (req, res) => {
  const { pledgeId } = req.params;
  const pledge = await Pledge.findOne({ _id: pledgeId, user: req.user._id });
  if (!pledge) return res.status(404).json({ success: false, message: "Pledge not found" });
  pledge.status = "cancelled";
  await pledge.save();
  res.status(200).json({ success: true, pledge });
};

export const listPledges = async (req, res) => {
  const pledges = await Pledge.find({ user: req.user._id }).sort({ createdAt: -1 });
  res.status(200).json({ success: true, pledges });
};

export const getPledgeStats = async (req, res) => {
  const pledges = await Pledge.find({ user: req.user._id });
  const totalPaidStroops = pledges.reduce((sum, pledge) => sum + BigInt(pledge.totalPaidStroops || "0"), 0n);
  const longestStreak = pledges.reduce((max, pledge) => Math.max(max, pledge.longestStreak || 0), 0);
  const currentStreak = pledges.reduce((max, pledge) => Math.max(max, pledge.consecutivePaid || 0), 0);
  res.status(200).json({ success: true, stats: { currentStreak, longestStreak, totalPaidStroops: totalPaidStroops.toString(), nextDueAt: pledges[0]?.nextDueAt || null } });
};

export const initializePledgeCycle = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { pledgeId, cycleId } = req.params;
    const pledge = await Pledge.findOne({ _id: pledgeId, user: req.user._id }).session(session);
    if (!pledge) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Pledge not found" });
    }
    const cycle = await PledgeCycle.findOne({ _id: cycleId, pledge: pledge._id }).session(session);
    if (!cycle || cycle.status === "paid") {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Cycle not found or already paid" });
    }
    const memo = buildPledgeMemo(pledge._id);
    const paymentTx = await buildPaymentTransaction({ sourcePublicKey: pledge.publicKey, destinationPublicKey: DONATION_WALLET_PUBLIC_KEY, amount: pledge.amount, memo });
    const sep7Uri = buildSep7Uri({ destination: DONATION_WALLET_PUBLIC_KEY, amount: pledge.amount, memo });
    const transaction = new Transaction({ type: "donation", buyer: req.user._id, buyerWallet: pledge.publicKey, creatorWallet: DONATION_WALLET_PUBLIC_KEY, amount: pledge.amount, network: NETWORK, status: "pending", expectedHash: paymentTx.hash, memo });
    await transaction.save({ session });
    cycle.transaction = transaction._id;
    cycle.status = "notified";
    await cycle.save({ session });
    await session.commitTransaction();
    paymentsInitialized.inc({ type: "donation" });
    res.status(200).json({ success: true, transactionId: transaction._id, transactionXdr: paymentTx.xdr, sep7Uri, networkPassphrase: paymentTx.networkPassphrase });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Initialize pledge cycle error", error);
    res.status(500).json({ success: false, message: "Failed to initialize pledge cycle" });
  } finally {
    session.endSession();
  }
};

export const submitPledgeCycle = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { pledgeId, cycleId } = req.params;
    const { signedXdr } = req.body;
    const pledge = await Pledge.findOne({ _id: pledgeId, user: req.user._id }).session(session);
    if (!pledge) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Pledge not found" });
    }
    const cycle = await PledgeCycle.findOne({ _id: cycleId, pledge: pledge._id }).session(session);
    if (!cycle || !cycle.transaction) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Cycle not found" });
    }
    const transaction = await Transaction.findById(cycle.transaction).session(session);
    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({ success: false, message: "Transaction not found" });
    }
    validateSignedPaymentXdr(signedXdr, [{ destination: transaction.creatorWallet, amount: transaction.amount }], transaction.memo, transaction.buyerWallet, true);
    transaction.status = "submitted";
    await transaction.save({ session });
    paymentsSubmitted.inc({ type: "donation" });
    const result = await submitTransaction(signedXdr);
    const verification = await verifyPaymentOperations(result.hash, [{ destination: transaction.creatorWallet, amount: transaction.amount }]);
    if (!verification.verified) {
      await session.commitTransaction();
      return res.status(400).json({ success: false, message: "Payment could not be verified" });
    }
    transaction.stellarTxHash = result.hash;
    transaction.stellarLedger = result.ledger;
    transaction.status = "confirmed";
    transaction.confirmedAt = new Date();
    await transaction.save({ session });
    cycle.status = "paid";
    await cycle.save({ session });
    pledge.consecutivePaid = (pledge.consecutivePaid || 0) + 1;
    pledge.longestStreak = Math.max(pledge.longestStreak || 0, pledge.consecutivePaid);
    pledge.totalPaidStroops = (BigInt(pledge.totalPaidStroops || "0") + BigInt(toStroops(pledge.amount))).toString();
    pledge.lastPaidAt = new Date();
    await pledge.save({ session });
    await session.commitTransaction();
    paymentsConfirmed.inc({ type: "donation" });
    res.status(200).json({ success: true, message: "Pledge cycle paid" });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Submit pledge cycle error", error);
    res.status(500).json({ success: false, message: "Failed to submit pledge cycle" });
  } finally {
    session.endSession();
  }
};
