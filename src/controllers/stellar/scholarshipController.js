import * as StellarSdk from "@stellar/stellar-sdk";
import ScholarshipContribution from "../../models/ScholarshipContribution.js";
import ScholarshipMilestoneReport from "../../models/ScholarshipMilestoneReport.js";
import {
  buildScholarshipFundingTransaction,
  buildScholarshipMilestoneApprovalTransaction,
  buildScholarshipRefundTransaction,
  fromStroops,
  getScholarshipEscrowState,
  scholarshipEscrowRpc,
} from "../../services/stellar/scholarshipEscrowService.js";
import logger from "../../config/logger.js";

const getUserWallet = (req) => req.user?.stellarWallet?.publicKey;

const milestoneIndex = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 99 ? parsed : null;
};

const serializeMilestoneReport = (report) => ({
  id: String(report._id),
  milestoneIndex: report.milestoneIndex,
  status: report.current.status,
  summary: report.current.summary,
  evidenceUrl: report.current.evidenceUrl || null,
  submittedAt: report.current.submittedAt,
  reviewedAt: report.current.reviewedAt || null,
  reviewNote: report.current.reviewNote || null,
  releaseTxHash: report.current.releaseTxHash || null,
});

export const getScholarshipMilestoneReports = async (req, res) => {
  try {
    const wallet = getUserWallet(req);
    if (!wallet) return res.status(400).json({ success: false, message: "Connect a Stellar wallet first" });
    const state = await getScholarshipEscrowState({ sourcePublicKey: wallet });
    const isBeneficiary = state.beneficiary === wallet;
    const isArbiter = req.user.role === "admin" && state.arbiter === wallet;
    if (!isBeneficiary && !isArbiter) return res.status(403).json({ success: false, message: "Only the beneficiary and arbiter can view milestone reports" });
    const reports = await ScholarshipMilestoneReport.find({ contractId: state.contractId }).sort({ milestoneIndex: 1 });
    await Promise.all(reports.map(async (report) => {
      const chainMilestone = state.milestones.find((item) => item.index === report.milestoneIndex);
      if (!chainMilestone?.released || report.current.status === "released") return;
      const release = await ScholarshipContribution.findOne({
        contractId: state.contractId,
        milestoneIndex: report.milestoneIndex,
        kind: "release",
      }).sort({ createdAt: -1 });
      if (release && release.status !== "confirmed") {
        release.status = "confirmed";
        release.confirmedAt = new Date();
        await release.save();
      }
      report.current.status = "released";
      report.current.releaseTxHash = release?.stellarTxHash;
      await report.save();
    }));
    return res.status(200).json({ success: true, reports: reports.map(serializeMilestoneReport) });
  } catch (error) {
    logger.warn({ message: error.message }, "Scholarship milestone report lookup failed");
    return res.status(error.statusCode || 503).json({ success: false, message: error.statusCode ? error.message : "Could not retrieve milestone report" });
  }
};

export const submitScholarshipMilestoneReport = async (req, res) => {
  try {
    const wallet = getUserWallet(req);
    if (!wallet) return res.status(400).json({ success: false, message: "Connect a Stellar wallet first" });
    const index = milestoneIndex(req.params.index);
    if (index === null) return res.status(400).json({ success: false, message: "Milestone index is invalid" });
    const summary = String(req.body?.summary || "").trim();
    const evidenceUrl = String(req.body?.evidenceUrl || "").trim();
    if (summary.length < 50 || summary.length > 2000) {
      return res.status(400).json({ success: false, message: "Progress summary must be between 50 and 2000 characters" });
    }
    if (evidenceUrl) {
      let url;
      try { url = new URL(evidenceUrl); } catch { return res.status(400).json({ success: false, message: "Evidence link must be a valid HTTPS URL" }); }
      if (url.protocol !== "https:" || !url.hostname || url.username || url.password) {
        return res.status(400).json({ success: false, message: "Evidence link must use HTTPS and cannot contain embedded credentials" });
      }
    }

    const state = await getScholarshipEscrowState({ sourcePublicKey: wallet });
    if (state.beneficiary !== wallet) return res.status(403).json({ success: false, message: "Only the scholarship beneficiary can submit milestone progress" });
    const milestone = state.milestones.find((item) => item.index === index);
    if (!milestone || milestone.released) return res.status(409).json({ success: false, message: "Milestone is missing or already released" });

    await ScholarshipMilestoneReport.collection.createIndex(
      { contractId: 1, milestoneIndex: 1 },
      { unique: true, name: "unique_scholarship_milestone_report" }
    );
    const existing = await ScholarshipMilestoneReport.findOne({ contractId: state.contractId, milestoneIndex: index });
    const current = {
      summary,
      evidenceUrl: evidenceUrl || undefined,
      submittedBy: req.user._id,
      submittedAt: new Date(),
      status: "submitted",
    };
    if (!existing) {
      const created = await ScholarshipMilestoneReport.create({
        contractId: state.contractId,
        milestoneIndex: index,
        beneficiaryWallet: wallet,
        current,
      });
      return res.status(201).json({ success: true, report: serializeMilestoneReport(created) });
    }
    if (existing.beneficiaryWallet !== wallet || existing.current.status !== "rejected") {
      return res.status(409).json({ success: false, message: "A report is already awaiting review or has been approved" });
    }
    const previous = existing.current.toObject ? existing.current.toObject() : existing.current;
    const updated = await ScholarshipMilestoneReport.findOneAndUpdate(
      { _id: existing._id, "current.status": "rejected" },
      { $push: { history: previous }, $set: { current } },
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(409).json({ success: false, message: "A new milestone report was submitted; refresh and try again" });
    return res.status(201).json({ success: true, report: serializeMilestoneReport(updated) });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ success: false, message: "A report is already awaiting review for this milestone" });
    logger.error({ message: error.message }, "Scholarship milestone report submission failed");
    return res.status(error.statusCode || 503).json({ success: false, message: error.statusCode ? error.message : "Could not submit milestone report" });
  }
};

export const reviewScholarshipMilestoneReport = async (req, res) => {
  const { decision, note } = req.body || {};
  if (!["approved", "rejected"].includes(decision)) return res.status(400).json({ success: false, message: "Decision must be approved or rejected" });
  if (typeof note !== "string" || note.trim().length < 20 || note.trim().length > 1200) {
    return res.status(400).json({ success: false, message: "Review note must be between 20 and 1200 characters" });
  }
  const index = milestoneIndex(req.params.index);
  if (index === null) return res.status(400).json({ success: false, message: "Milestone index is invalid" });
  if (!/^[a-f\d]{24}$/i.test(req.params.reportId)) return res.status(400).json({ success: false, message: "Invalid milestone report ID" });
  try {
    const arbiterWallet = getUserWallet(req);
    if (!arbiterWallet) return res.status(400).json({ success: false, message: "Connect the arbiter Stellar wallet first" });
    const state = await getScholarshipEscrowState({ sourcePublicKey: arbiterWallet });
    if (state.arbiter !== arbiterWallet) return res.status(403).json({ success: false, message: "Connected wallet is not this campaign's arbiter" });
    const report = await ScholarshipMilestoneReport.findOneAndUpdate(
      {
        _id: req.params.reportId,
        contractId: state.contractId,
        milestoneIndex: index,
        "current.status": "submitted",
        "current.submittedBy": { $ne: req.user._id },
      },
      { $set: {
        "current.status": decision,
        "current.reviewer": req.user._id,
        "current.reviewedAt": new Date(),
        "current.reviewNote": note.trim(),
      } },
      { new: true, runValidators: true }
    );
    if (!report) {
      const existing = await ScholarshipMilestoneReport.findById(req.params.reportId);
      if (existing && String(existing.current.submittedBy) === String(req.user._id)) {
        return res.status(403).json({ success: false, message: "The beneficiary cannot review their own milestone report" });
      }
      return res.status(404).json({ success: false, message: "Pending milestone report not found" });
    }
    return res.status(200).json({ success: true, report: serializeMilestoneReport(report) });
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship milestone review failed");
    return res.status(error.statusCode || 503).json({ success: false, message: error.statusCode ? error.message : "Could not review milestone report" });
  }
};

export const getScholarshipState = async (req, res) => {
  try {
    const state = await getScholarshipEscrowState({ sourcePublicKey: getUserWallet(req) });
    return res.status(200).json({ success: true, scholarship: state });
  } catch (error) {
    const status = error.statusCode || 503;
    logger.warn({ message: error.message }, "Scholarship escrow state unavailable");
    return res.status(status).json({
      success: false,
      message: status < 500 ? error.message : "Scholarship information is temporarily unavailable",
    });
  }
};

export const initializeScholarshipContribution = async (req, res) => {
  try {
    const donorWallet = getUserWallet(req);
    if (!donorWallet) {
      return res.status(400).json({ success: false, message: "Connect and save a Stellar wallet first" });
    }

    const transaction = await buildScholarshipFundingTransaction({
      sourcePublicKey: donorWallet,
      amount: req.body.amount,
    });
    const contribution = await ScholarshipContribution.create({
      donor: req.user._id,
      donorWallet,
      contractId: transaction.contractId,
      network: transaction.network,
      amountStroops: transaction.amountStroops,
      kind: "fund",
      expectedHash: transaction.expectedHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });

    return res.status(200).json({
      success: true,
      contributionId: contribution._id,
      amount: fromStroops(BigInt(transaction.amountStroops)),
      transactionXdr: transaction.xdr,
      networkPassphrase: transaction.networkPassphrase,
    });
  } catch (error) {
    logger.warn({ message: error.message }, "Scholarship contribution initialization failed");
    return res.status(error.statusCode || 503).json({
      success: false,
      message: error.statusCode ? error.message : "Could not prepare the scholarship contribution",
    });
  }
};

export const initializeScholarshipRefund = async (req, res) => {
  try {
    const donorWallet = getUserWallet(req);
    if (!donorWallet) {
      return res.status(400).json({ success: false, message: "Connect and save a Stellar wallet first" });
    }
    const transaction = await buildScholarshipRefundTransaction({ sourcePublicKey: donorWallet });
    const contribution = await ScholarshipContribution.create({
      donor: req.user._id,
      donorWallet,
      contractId: transaction.contractId,
      network: transaction.network,
      kind: "refund",
      expectedHash: transaction.expectedHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return res.status(200).json({
      success: true,
      contributionId: contribution._id,
      transactionXdr: transaction.xdr,
      networkPassphrase: transaction.networkPassphrase,
    });
  } catch (error) {
    logger.warn({ message: error.message }, "Scholarship refund initialization failed");
    return res.status(error.statusCode || 503).json({
      success: false,
      message: error.statusCode ? error.message : "Could not prepare the scholarship refund",
    });
  }
};

export const initializeScholarshipMilestoneApproval = async (req, res) => {
  try {
    const arbiterWallet = getUserWallet(req);
    if (!arbiterWallet) {
      return res.status(400).json({ success: false, message: "Connect and save the arbiter Stellar wallet first" });
    }
    const state = await getScholarshipEscrowState({ sourcePublicKey: arbiterWallet });
    if (state.arbiter !== arbiterWallet) {
      return res.status(403).json({ success: false, message: "Connected wallet is not this campaign's arbiter" });
    }
    const index = milestoneIndex(req.params.index);
    if (index === null) return res.status(400).json({ success: false, message: "Milestone index is invalid" });
    const milestone = state.milestones.find((item) => item.index === index);
    if (!milestone || milestone.released) {
      return res.status(409).json({ success: false, message: "Milestone is missing or already released" });
    }
    if (!/^[a-f\d]{24}$/i.test(String(req.body?.reportId || ""))) {
      return res.status(400).json({ success: false, message: "An approved milestone report ID is required" });
    }
    const report = await ScholarshipMilestoneReport.findOne({
      _id: req.body?.reportId,
      contractId: state.contractId,
      milestoneIndex: index,
      "current.status": "approved",
    });
    if (!report) return res.status(409).json({ success: false, message: "An arbiter-approved progress report is required before release" });
    const transaction = await buildScholarshipMilestoneApprovalTransaction({
      sourcePublicKey: arbiterWallet,
      index,
    });
    const contribution = await ScholarshipContribution.create({
      donor: req.user._id,
      donorWallet: arbiterWallet,
      contractId: transaction.contractId,
      network: transaction.network,
      kind: "release",
      milestoneIndex: index,
      milestoneReport: report._id,
      expectedHash: transaction.expectedHash,
      status: "pending",
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
    });
    return res.status(200).json({
      success: true,
      contributionId: contribution._id,
      transactionXdr: transaction.xdr,
      networkPassphrase: transaction.networkPassphrase,
      milestoneIndex: index,
    });
  } catch (error) {
    logger.warn({ message: error.message }, "Scholarship milestone approval initialization failed");
    return res.status(error.statusCode || 503).json({
      success: false,
      message: error.statusCode ? error.message : "Could not prepare milestone release",
    });
  }
};

export const submitScholarshipContribution = async (req, res) => {
  try {
    const { contributionId, signedXdr } = req.body;
    if (!contributionId || !signedXdr) {
      return res.status(400).json({ success: false, message: "Contribution ID and signed transaction are required" });
    }

    const contribution = await ScholarshipContribution.findOne({
      _id: contributionId,
      donor: req.user._id,
      status: { $in: ["pending", "submitted"] },
      expiresAt: { $gt: new Date() },
    });
    if (!contribution) {
      return res.status(404).json({ success: false, message: "Pending scholarship contribution not found" });
    }

    const { server, networkPassphrase } = scholarshipEscrowRpc();
    let transaction;
    try {
      transaction = StellarSdk.TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
    } catch {
      return res.status(400).json({ success: false, message: "Signed transaction is invalid for this network" });
    }

    const submittedHash = transaction.hash().toString("hex");
    if (submittedHash !== contribution.expectedHash) {
      return res.status(400).json({ success: false, message: "Signed transaction does not match this contribution" });
    }

    contribution.status = "submitted";
    contribution.stellarTxHash = submittedHash;
    contribution.expiresAt = undefined;
    await contribution.save();

    const sent = await server.sendTransaction(transaction);
    if (sent.status === "ERROR") {
      contribution.status = "failed";
      contribution.failureReason = sent.errorResult || "Soroban RPC rejected the transaction";
      await contribution.save();
      return res.status(400).json({ success: false, message: "The scholarship transaction was rejected" });
    }

    return res.status(202).json({
      success: true,
      status: "submitted",
      contributionId: contribution._id,
      txHash: submittedHash,
      explorerUrl: `https://stellar.expert/explorer/${contribution.network === "mainnet" ? "public" : "testnet"}/tx/${submittedHash}`,
    });
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship contribution submission failed");
    return res.status(503).json({ success: false, message: "Could not submit the scholarship transaction" });
  }
};

export const getScholarshipContribution = async (req, res) => {
  try {
    const contribution = await ScholarshipContribution.findOne({
      _id: req.params.contributionId,
      donor: req.user._id,
    });
    if (!contribution) {
      return res.status(404).json({ success: false, message: "Scholarship contribution not found" });
    }

    if (contribution.status === "submitted" && contribution.stellarTxHash) {
      const { server } = scholarshipEscrowRpc();
      const result = await server.getTransaction(contribution.stellarTxHash);
      if (result.status === "SUCCESS") {
        contribution.status = "confirmed";
        contribution.confirmedAt = new Date();
        await contribution.save();
        if (contribution.kind === "release" && contribution.milestoneReport) {
          await ScholarshipMilestoneReport.updateOne(
            { _id: contribution.milestoneReport, "current.status": "approved" },
            { $set: { "current.status": "released", "current.releaseTxHash": contribution.stellarTxHash } }
          );
        }
      } else if (result.status === "FAILED") {
        contribution.status = "failed";
        contribution.failureReason = "Soroban transaction failed on network";
        await contribution.save();
      }
    }

    return res.status(200).json({
      success: true,
      contribution: {
        id: contribution._id,
        kind: contribution.kind,
        amount: contribution.kind === "fund" ? fromStroops(BigInt(contribution.amountStroops)) : null,
        milestoneIndex: contribution.milestoneIndex,
        status: contribution.status,
        txHash: contribution.stellarTxHash,
        confirmedAt: contribution.confirmedAt,
        explorerUrl: contribution.stellarTxHash
          ? `https://stellar.expert/explorer/${contribution.network === "mainnet" ? "public" : "testnet"}/tx/${contribution.stellarTxHash}`
          : null,
      },
    });
  } catch (error) {
    logger.error({ message: error.message }, "Scholarship contribution status lookup failed");
    return res.status(503).json({ success: false, message: "Could not retrieve contribution status" });
  }
};
