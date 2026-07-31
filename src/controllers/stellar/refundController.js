// controllers/stellar/refundController.js
import mongoose from "mongoose";
import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import Transaction from "../../models/Transaction.js";
import Refund from "../../models/Refund.js";
import {
  buildReversePaymentTransaction,
  submitTransaction,
  verifyPaymentOperations,
} from "../../services/stellar/stellarService.js";
import { isAssetSupported, getSupportedCodes } from "../../config/assets.js";
import logger from "../../config/logger.js";

const REFUND_WINDOW_DAYS = parseInt(process.env.REFUND_WINDOW_DAYS || "14", 10);

/**
 * Buyer requests a refund
 * POST /api/stellar/payment/transactions/:id/refund-request
 */
export const requestRefund = async (req, res) => {
  try {
    const { id: transactionId } = req.params;
    const { reason } = req.body;
    const buyerId = req.user._id;

    if (!reason || typeof reason !== "string" || !reason.trim()) {
      return res.status(400).json({
        success: false,
        message: "A valid refund reason is required",
      });
    }

    const transaction = await Transaction.findById(transactionId);
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    if (transaction.buyer.toString() !== buyerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: You are not the purchaser of this item",
      });
    }

    if (transaction.status !== "confirmed") {
      return res.status(400).json({
        success: false,
        message: `Cannot request refund for transaction in '${transaction.status}' status`,
      });
    }

    const confirmedTime = new Date(
      transaction.confirmedAt || transaction.updatedAt
    ).getTime();
    const windowMs = REFUND_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() - confirmedTime > windowMs) {
      return res.status(400).json({
        success: false,
        message: `Refund window of ${REFUND_WINDOW_DAYS} days has expired for this transaction`,
      });
    }

    const existingRefund = await Refund.findOne({
      originalTransaction: transaction._id,
      status: { $in: ["requested", "approved", "submitted", "confirmed", "disputed"] },
    });

    if (existingRefund) {
      return res.status(400).json({
        success: false,
        message: "An active or completed refund request already exists for this transaction",
        refundId: existingRefund._id,
      });
    }

    const refund = await Refund.create({
      originalTransaction: transaction._id,
      buyer: transaction.buyer,
      educator: transaction.creator,
      itemType: transaction.itemType,
      itemId: transaction.itemId,
      amount: transaction.amount,
      currency: transaction.currency || "USDC",
      reason: reason.trim(),
      status: "requested",
      expiresAt: new Date(Date.now() + windowMs),
    });

    transaction.refund = refund._id;
    await transaction.save();

    logger.info(`Refund requested for transaction ${transaction._id} by buyer ${buyerId}`);

    return res.status(201).json({
      success: true,
      message: "Refund request submitted successfully",
      refund,
    });
  } catch (error) {
    logger.error("Error requesting refund:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to request refund",
    });
  }
};

/**
 * Educator approves refund & builds reverse payment XDR
 * POST /api/stellar/payment/refunds/:refundId/build
 */
export const buildRefundXdr = async (req, res) => {
  try {
    const { refundId } = req.params;
    const educatorId = req.user._id;

    const refund = await Refund.findById(refundId).populate("originalTransaction");
    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund request not found",
      });
    }

    if (refund.educator.toString() !== educatorId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only the educator can approve this refund",
      });
    }

    if (refund.status !== "requested") {
      return res.status(400).json({
        success: false,
        message: `Cannot build reverse payment for refund in '${refund.status}' status`,
      });
    }

    // Validate the refund's currency before resolving an asset from it, so
    // an unsupported/unknown currency returns a clean 400 instead of a 500
    // from buildReversePaymentTransaction's resolveAsset call.
    const refundAssetCode = refund.currency || "USDC";
    if (!isAssetSupported(refundAssetCode)) {
      return res.status(400).json({
        success: false,
        message: `Refund currency ${refundAssetCode} is not supported. Supported: ${getSupportedCodes().join(", ")}`,
      });
    }

    const buyer = await User.findById(refund.buyer);
    const educator = await User.findById(refund.educator);

    const buyerWallet = buyer?.stellarWallet?.publicKey;
    const educatorWallet = educator?.stellarWallet?.publicKey;

    if (!buyerWallet || !educatorWallet) {
      return res.status(400).json({
        success: false,
        message: "Missing wallet information for buyer or educator",
      });
    }

    const originalTxHash = refund.originalTransaction?.stellarTxHash || "";

    // Build reverse payment transaction (educator -> buyer), in the same
    // asset the original payment was made in, so an EURC/XLM purchase is
    // refunded in EURC/XLM rather than always defaulting to USDC.
    const result = await buildReversePaymentTransaction({
      sourcePublicKey: educatorWallet,
      destinationPublicKey: buyerWallet,
      amount: refund.amount,
      originalTxHash,
      assetCode: refundAssetCode,
    });

    refund.status = "approved";
    await refund.save();

    logger.info(`Reverse payment XDR built for refund ${refund._id} by educator ${educatorId}`);

    return res.status(200).json({
      success: true,
      message: "Unsigned reverse payment XDR built successfully",
      refund,
      unsignedXdr: result.xdr,
      networkPassphrase: result.networkPassphrase,
    });
  } catch (error) {
    logger.error("Error building refund XDR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to build refund XDR",
    });
  }
};

/**
 * Educator submits signed reverse payment XDR & triggers atomic revocation
 * POST /api/stellar/payment/refunds/:refundId/submit
 */
export const submitRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { signedXdr } = req.body;
    const educatorId = req.user._id;

    if (!signedXdr) {
      return res.status(400).json({
        success: false,
        message: "signedXdr is required",
      });
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund request not found",
      });
    }

    if (refund.educator.toString() !== educatorId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only the educator can submit this refund",
      });
    }

    if (refund.status !== "approved") {
      return res.status(400).json({
        success: false,
        message: `Cannot submit refund in '${refund.status}' status. Must be 'approved' first.`,
      });
    }

    // Fetch the buyer once up front: we need their wallet as the expected
    // destination for on-chain verification below, and we reuse the same
    // buyer document for access revocation later instead of looking it up
    // a second time.
    const buyer = await User.findById(refund.buyer);
    const buyerWallet = buyer?.stellarWallet?.publicKey;
    if (!buyerWallet) {
      refund.status = "failed";
      await refund.save();
      return res.status(400).json({
        success: false,
        message: "Missing buyer wallet information; cannot verify refund payment",
      });
    }

    // Submit transaction to Stellar network
    let submissionResult;
    try {
      submissionResult = await submitTransaction(signedXdr);
    } catch (submitErr) {
      refund.status = "failed";
      await refund.save();
      return res.status(400).json({
        success: false,
        message: `Stellar transaction failed: ${submitErr.message}`,
      });
    }

    // On-Chain Truth Verification via Horizon: validate the actual reverse
    // payment operation (destination, amount, and asset), not just that a
    // successful transaction with this hash exists on Horizon.
    const verification = await verifyPaymentOperations(
      submissionResult.hash,
      [{ destination: buyerWallet, amount: refund.amount }],
      refund.currency || "USDC"
    );
    if (!verification.verified) {
      refund.status = "failed";
      await refund.save();
      return res.status(400).json({
        success: false,
        message: `Reverse payment could not be verified on Horizon: ${verification.reason || "payment mismatch"}`,
      });
    }

    // Access Revocation — sequential writes (no session/transaction required;
    // the Stellar on-chain verification above is the source of truth)
    try {
      if (refund.itemType === "course") {
        // Remove course from buyer's purchased list. purchasedCourses
        // entries are subdocuments ({ courseId, purchaseDate }), so match
        // on the courseId field rather than the subdocument itself.
        if (buyer) {
          buyer.purchasedCourses = (buyer.purchasedCourses || []).filter(
            (entry) => entry.courseId?.toString() !== refund.itemId.toString()
          );
          await buyer.save();
        }

        const course = await Course.findById(refund.itemId);
        if (course) {
          course.enrolledUsers = (course.enrolledUsers || []).filter(
            (uId) => uId.toString() !== refund.buyer.toString()
          );
          await course.save();
        }
      } else if (refund.itemType === "book") {
        // Same subdocument shape as above: match on bookId, not the entry.
        if (buyer) {
          buyer.purchasedBooks = (buyer.purchasedBooks || []).filter(
            (entry) => entry.bookId?.toString() !== refund.itemId.toString()
          );
          await buyer.save();
        }
      }

      refund.status = "confirmed";
      refund.refundTxHash = submissionResult.hash;
      refund.refundLedger = submissionResult.ledger;
      await refund.save();

      await Transaction.findByIdAndUpdate(
        refund.originalTransaction,
        { status: "refunded", refund: refund._id }
      );

      logger.info(`Refund confirmed and access revoked atomically for refund ${refund._id}`);
    } catch (revokeErr) {
      logger.error("Error during atomic access revocation:", revokeErr);
      throw revokeErr;
    }

    return res.status(200).json({
      success: true,
      message: "Refund confirmed on-chain and item access revoked successfully",
      refund,
      txHash: submissionResult.hash,
    });
  } catch (error) {
    logger.error("Error submitting refund:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to submit refund",
    });
  }
};

/**
 * Educator rejects a refund request
 * POST /api/stellar/payment/refunds/:refundId/reject
 */
export const rejectRefund = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { rejectionReason } = req.body;
    const educatorId = req.user._id;

    const refund = await Refund.findById(refundId);
    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund request not found",
      });
    }

    if (refund.educator.toString() !== educatorId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only the educator can reject this refund",
      });
    }

    if (refund.status !== "requested") {
      return res.status(400).json({
        success: false,
        message: `Cannot reject refund in '${refund.status}' status`,
      });
    }

    refund.status = "rejected";
    refund.rejectionReason = rejectionReason || "Refund request rejected by educator";
    await refund.save();

    logger.info(`Refund ${refund._id} rejected by educator ${educatorId}`);

    return res.status(200).json({
      success: true,
      message: "Refund request rejected",
      refund,
    });
  } catch (error) {
    logger.error("Error rejecting refund:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to reject refund",
    });
  }
};

/**
 * Buyer escalates refund to dispute
 * POST /api/stellar/payment/refunds/:refundId/dispute
 */
export const escalateDispute = async (req, res) => {
  try {
    const { refundId } = req.params;
    const buyerId = req.user._id;

    const refund = await Refund.findById(refundId);
    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund request not found",
      });
    }

    if (refund.buyer.toString() !== buyerId.toString()) {
      return res.status(403).json({
        success: false,
        message: "Forbidden: Only the buyer can escalate this dispute",
      });
    }

    if (!["requested", "rejected"].includes(refund.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot escalate refund in '${refund.status}' status`,
      });
    }

    refund.status = "disputed";
    await refund.save();

    await Transaction.findByIdAndUpdate(refund.originalTransaction, {
      status: "disputed",
    });

    logger.info(`Refund ${refund._id} escalated to dispute by buyer ${buyerId}`);

    return res.status(200).json({
      success: true,
      message: "Refund request escalated to dispute for admin review",
      refund,
    });
  } catch (error) {
    logger.error("Error escalating dispute:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to escalate dispute",
    });
  }
};

/**
 * Admin / Arbiter resolves a dispute
 * PATCH /api/stellar/payment/refunds/:refundId/arbitrate
 */
export const arbitrateDispute = async (req, res) => {
  try {
    const { refundId } = req.params;
    const { decision, notes } = req.body;
    const adminId = req.user._id;

    if (!["approved", "rejected", "off_chain_resolved"].includes(decision)) {
      return res.status(400).json({
        success: false,
        message: "Invalid decision. Must be 'approved', 'rejected', or 'off_chain_resolved'",
      });
    }

    const refund = await Refund.findById(refundId);
    if (!refund) {
      return res.status(404).json({
        success: false,
        message: "Refund request not found",
      });
    }

    if (refund.status !== "disputed") {
      return res.status(400).json({
        success: false,
        message: `Cannot arbitrate refund in '${refund.status}' status. Must be 'disputed'`,
      });
    }

    refund.resolution = {
      decision,
      notes: notes || "",
      resolvedBy: adminId,
      resolvedAt: new Date(),
    };
    refund.status = "resolved";
    await refund.save();

    logger.info(`Dispute for refund ${refund._id} arbitrated by admin ${adminId}`);

    return res.status(200).json({
      success: true,
      message:
        "Dispute resolution recorded successfully. Note: DeenBridge is a non-custodial platform; on-chain funds transfers require the creator's wallet signature.",
      refund,
      disclaimer:
        "Non-custodial Limitation: The platform wallet does not hold buyer or creator funds and cannot unilaterally move Stellar assets on-chain without the educator's signed transaction.",
    });
  } catch (error) {
    logger.error("Error arbitrating dispute:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to arbitrate dispute",
    });
  }
};