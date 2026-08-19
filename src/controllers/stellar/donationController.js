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
  validateSignedPaymentXdr,
  getExplorerUrl,
  NETWORK,
  DONATION_WALLET_PUBLIC_KEY,
} from "../../services/stellar/stellarService.js";
import {
  isFeeSponsorEnabled,
  prepareSponsoredSubmission,
  recordSponsorshipSpend,
  SponsorshipError,
} from "../../services/stellar/feeSponsorService.js";
import logger from "../../config/logger.js";
import { enqueue } from "../../jobs/queue.js";
import {
  paymentsInitialized,
  paymentsSubmitted,
  paymentsConfirmed,
  paymentsFailed,
  sponsorshipsApproved,
  sponsorshipsRejected,
} from "../../config/metrics.js";

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
      expectedHash: paymentTx.hash,
      memo: DONATION_MEMO,
    });

    await donation.save({ session });
    await session.commitTransaction();
    paymentsInitialized.inc({ type: "donation" });

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
    const { donationId, signedXdr, requestSponsorship } = req.body;
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

    // Build expected payments array for validation
    const expectedPayments = [
      {
        destination: donation.creatorWallet,
        amount: donation.amount,
      },
    ];

    // Fee-bump sponsorship (#30): opt-in and only when the master switch is on.
    // Skipped entirely with the flag off — the donation submit path below is
    // then byte-for-byte the original unsponsored flow.
    const wantSponsor = requestSponsorship === true && isFeeSponsorEnabled();
    let submissionXdr = signedXdr;
    let sponsorship = null;

    if (wantSponsor) {
      try {
        sponsorship = await prepareSponsoredSubmission({
          signedXdr,
          transactionRow: donation,
          userId: donorId,
          session,
        });
        submissionXdr = sponsorship.feeBumpXdr;
      } catch (sponsorError) {
        if (sponsorError instanceof SponsorshipError) {
          // Sponsorship-specific failure: leave the donation pending so the
          // client can retry unsponsored; never mark it failed.
          await session.abortTransaction();
          sponsorshipsRejected.inc({
            type: "donation",
            reason: sponsorError.code,
          });
          logger.info(
            `Sponsorship rejected for donation ${donationId}: ${sponsorError.code}`
          );
          return res.status(sponsorError.httpStatus).json({
            success: false,
            message: "Fee sponsorship was not applied; retry without sponsorship",
            sponsorship: { approved: false, reason: sponsorError.code },
            retryUnsponsored: true,
          });
        }
        throw sponsorError;
      }
      sponsorshipsApproved.inc({ type: "donation" });
      logger.info(`Sponsorship approved for donation ${donationId}`);
    } else {
      // Validate signed XDR contents (memo, payments, optional source)
      try {
        validateSignedPaymentXdr(
          signedXdr,
          expectedPayments,
          donation.memo,
          donation.buyerWallet,
          true
        );
      } catch (validationError) {
        donation.status = "failed";
        donation.expiresAt = undefined;
        donation.failureReason = `validation_failed: ${validationError.message}`;
        await donation.save({ session });
        await session.commitTransaction();
        paymentsFailed.inc({ type: "donation", reason: "validation_failed" });

        logger.error(`Donation ${donationId} validation failed:`, validationError.message);

        return res.status(400).json({
          success: false,
          message: "Signed transaction does not match expected payment details",
          error: validationError.message,
        });
      }
    }

    // Update status to submitted after validation
    donation.status = "submitted";
    donation.submittedAt = new Date();
    await donation.save({ session });
    paymentsSubmitted.inc({ type: "donation" });

    // Submit to Stellar network
    let result;
    try {
      result = await submitTransaction(submissionXdr);
    } catch (stellarError) {
      donation.status = "failed";
      donation.expiresAt = undefined;
      donation.failureReason = stellarError.message;
      await donation.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "donation", reason: "stellar_error" });

      logger.error(`Donation ${donationId} failed:`, stellarError);

      return res.status(400).json({
        success: false,
        message: "Donation failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Sponsored submits: the fee-bump has landed, so account the spend (with
    // the real fee_charged) and stamp the sponsorship fields. Verification and
    // the stored hash use the inner-transaction hash (which matches
    // `expectedHash`); the fee-bump (outer) hash is kept alongside.
    if (sponsorship) {
      donation.sponsored = true;
      donation.feeBumpTxHash = sponsorship.outerHash;
      donation.sponsorFeeCharged =
        result.feeCharged != null
          ? String(result.feeCharged)
          : String(sponsorship.maxFeeStroops);
      try {
        await recordSponsorshipSpend({
          userId: donorId,
          feeStroops:
            result.feeCharged != null
              ? Number(result.feeCharged)
              : sponsorship.maxFeeStroops,
          session,
        });
      } catch (spendErr) {
        logger.error(
          `Failed to record sponsorship spend for donation ${donationId}:`,
          spendErr
        );
      }
    }

    const settledHash = sponsorship ? sponsorship.innerHash : result.hash;

    // Verify on-chain that the donation actually paid the fund (amount, destination, asset)
    // (expectedPayments already defined above for pre-submission validation)
    const verification = await verifyPaymentOperations(settledHash, expectedPayments);

    if (!verification.verified) {
      donation.stellarTxHash = settledHash;
      if (verification.transient) {
        donation.status = "retrying";
        donation.failureReason = verification.reason;
        await donation.save({ session });
        await enqueue(
          "verifyPaymentOnChain",
          { transactionId: donation._id.toString() },
          {
            attempts: 5,
            backoffMs: 1000,
            idempotencyKey: `verify:${settledHash}`,
            session,
          }
        );
        await session.commitTransaction();
        return res.status(202).json({
          success: true,
          message: "Donation submitted; confirmation is in progress",
          donationId: donation._id,
          txHash: settledHash,
          status: "retrying",
          ...(sponsorship && { sponsored: true }),
        });
      }
      donation.status = "failed";
      donation.expiresAt = undefined;
      donation.failureReason = `On-chain verification failed: ${verification.reason}`;
      await donation.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "donation", reason: "verification_failed" });

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
    donation.stellarTxHash = settledHash;
    donation.stellarLedger = result.ledger;
    donation.status = "confirmed";
    donation.confirmedAt = new Date();
    donation.expiresAt = undefined; // terminal state — never TTL-reapable
    await donation.save({ session });
    await enqueue(
      "generateReceipt",
      { transactionId: donation._id.toString() },
      {
        attempts: 5,
        backoffMs: 1000,
        idempotencyKey: `receipt:${settledHash}`,
        session,
      }
    );
    await session.commitTransaction();
    paymentsConfirmed.inc({ type: "donation" });

    logger.info(
      `Donation successful: ${donationId}, Stellar TX: ${settledHash}${sponsorship ? " (sponsored)" : ""}`
    );

    res.status(200).json({
      success: true,
      message: "JazakAllah khair! Your sadaqah has been received.",
      txHash: settledHash,
      explorerUrl: getExplorerUrl(settledHash),
      ...(sponsorship && {
        sponsored: true,
        feeBumpTxHash: sponsorship.outerHash,
        sponsorFeeCharged: donation.sponsorFeeCharged,
      }),
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
