// controllers/stellar/donationController.js
import mongoose from "mongoose";
import Transaction from "../../models/Transaction.js";
import {
  isValidPublicKey,
  getAccountBalance,
  buildPaymentTransaction,
  buildSep7Uri,
  submitTransaction,
  verifyPaymentOperations,
  getExplorerUrl,
  NETWORK,
  DONATION_WALLET_PUBLIC_KEY,
} from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";

const DONATION_MEMO = "DNB-SADAQAH";

/**
 * Initialize a sadaqah donation - creates pending record and returns XDR to sign
 * POST /api/stellar/donation/initialize
 */
export const initializeDonation = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const donorId = req.user._id;
    const { amount, publicKey } = req.body;

    // Donation wallet must be configured on the server
    if (!DONATION_WALLET_PUBLIC_KEY) {
      await session.abortTransaction();
      return res.status(503).json({
        success: false,
        message: "Donations are not available right now. Please try again later.",
      });
    }

    // Validate donor public key
    if (!publicKey || !isValidPublicKey(publicKey)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid Stellar public key",
      });
    }

    // Validate amount (positive, max 7 decimal places)
    const parsedAmount = Number(amount);
    if (
      !amount ||
      !Number.isFinite(parsedAmount) ||
      parsedAmount <= 0 ||
      !/^\d+(\.\d{1,7})?$/.test(amount.toString())
    ) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message:
          "Invalid amount. Must be a positive number with at most 7 decimal places",
      });
    }

    // Build the donation payment transaction (donor -> donation fund)
    const paymentTx = await buildPaymentTransaction({
      sourcePublicKey: publicKey,
      destinationPublicKey: DONATION_WALLET_PUBLIC_KEY,
      amount: amount.toString(),
      memo: DONATION_MEMO,
    });

    // SEP-7 URI so wallets can deep-link the same payment
    const sep7Uri = buildSep7Uri({
      destination: DONATION_WALLET_PUBLIC_KEY,
      amount: amount.toString(),
      memo: DONATION_MEMO,
    });

    // Create pending donation record
    const donation = new Transaction({
      type: "donation",
      buyer: donorId,
      buyerWallet: publicKey,
      creatorWallet: DONATION_WALLET_PUBLIC_KEY,
      amount: amount.toString(),
      network: NETWORK,
      status: "pending",
      stellarTxHash: paymentTx.hash, // Temporary hash, will be replaced with actual
    });

    await donation.save({ session });
    await session.commitTransaction();

    logger.info(`Donation initialized: ${donation._id} for ${amount} USDC`);

    res.status(200).json({
      success: true,
      donationId: donation._id,
      transactionXdr: paymentTx.xdr,
      sep7Uri,
      networkPassphrase: paymentTx.networkPassphrase,
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Initialize donation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize donation",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Submit signed donation transaction
 * POST /api/stellar/donation/submit
 */
export const submitDonation = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { donationId, signedXdr } = req.body;
    const donorId = req.user._id;

    if (!donationId || !signedXdr) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Donation ID and signed XDR are required",
      });
    }

    // Find the pending donation
    const donation = await Transaction.findOne({
      _id: donationId,
      buyer: donorId,
      type: "donation",
      status: "pending",
    }).session(session);

    if (!donation) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Donation not found or already processed",
      });
    }

    // Update status to submitted
    donation.status = "submitted";
    donation.submittedAt = new Date();
    await donation.save({ session });

    // Submit to Stellar network
    let result;
    try {
      result = await submitTransaction(signedXdr);
    } catch (stellarError) {
      donation.status = "failed";
      donation.failureReason = stellarError.message;
      await donation.save({ session });
      await session.commitTransaction();

      logger.error(`Donation ${donationId} failed:`, stellarError);

      return res.status(400).json({
        success: false,
        message: "Donation failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Verify on-chain that the donation actually paid the fund (amount, destination, asset)
    const verification = await verifyPaymentOperations(result.hash, [
      {
        destination: donation.creatorWallet,
        amount: donation.amount,
      },
    ]);

    if (!verification.verified) {
      donation.status = "failed";
      donation.failureReason = `On-chain verification failed: ${verification.reason}`;
      donation.stellarTxHash = result.hash;
      await donation.save({ session });
      await session.commitTransaction();

      logger.error(
        `Donation ${donationId} verification failed: ${verification.reason}`
      );

      return res.status(400).json({
        success: false,
        message: "Donation could not be verified on the Stellar network",
        error: verification.reason,
      });
    }

    // Mark confirmed
    donation.stellarTxHash = result.hash;
    donation.stellarLedger = result.ledger;
    donation.status = "confirmed";
    donation.confirmedAt = new Date();
    await donation.save({ session });
    await session.commitTransaction();

    logger.info(
      `Donation successful: ${donationId}, Stellar TX: ${result.hash}`
    );

    res.status(200).json({
      success: true,
      message: "JazakAllah khair! Your sadaqah has been received.",
      txHash: result.hash,
      explorerUrl: getExplorerUrl(result.hash),
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Submit donation error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process donation",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get public donation pool stats (no donor identity exposed)
 * GET /api/stellar/donation/stats
 */
export const getDonationStats = async (req, res) => {
  try {
    if (!DONATION_WALLET_PUBLIC_KEY) {
      return res.status(503).json({
        success: false,
        message: "Donation wallet is not configured",
      });
    }

    // Live USDC balance of the donation fund from Horizon
    const balance = await getAccountBalance(DONATION_WALLET_PUBLIC_KEY);

    // Aggregate confirmed donations
    const [totals] = await Transaction.aggregate([
      { $match: { type: "donation", status: "confirmed" } },
      {
        $group: {
          _id: null,
          donationCount: { $sum: 1 },
          totalDonated: { $sum: { $toDouble: "$amount" } },
        },
      },
    ]);

    // Recent confirmed donations - amounts and hashes only, no donor identity
    const recentDonations = await Transaction.find({
      type: "donation",
      status: "confirmed",
    })
      .sort({ createdAt: -1 })
      .limit(10)
      .select("amount stellarTxHash createdAt");

    res.status(200).json({
      success: true,
      poolBalance: balance.usdcBalance,
      donationCount: totals?.donationCount || 0,
      totalDonated: totals?.totalDonated || 0,
      recent: recentDonations.map((donation) => ({
        amount: donation.amount,
        txHash: donation.stellarTxHash,
        explorerUrl: getExplorerUrl(donation.stellarTxHash),
        createdAt: donation.createdAt,
      })),
    });
  } catch (error) {
    logger.error("Get donation stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch donation stats",
    });
  }
};
