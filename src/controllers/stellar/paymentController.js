// controllers/stellar/paymentController.js
import mongoose from "mongoose";
import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import Transaction from "../../models/Transaction.js";
import {
  buildPaymentTransaction,
  buildPathPaymentTransaction,
  buildSep7Uri,
  calculateFeeSplit,
  preflightPayment,
  submitTransaction,
  verifyTransaction,
  verifyPaymentOperations,
  findPaymentPaths,
  applySlippage,
  NETWORK,
  getExplorerUrl,
  USDC,
  PLATFORM_WALLET_PUBLIC_KEY,
  hasUsdcTrustline,
} from "../../services/stellar/stellarService.js";
import { buildCreateClaimableBalanceTx, resolveBalanceId } from "../../services/stellar/claimableBalanceService.js";
import { recordSaleEarnings } from "../../services/payoutService.js";
import { enqueue } from "../../jobs/queue.js";
import logger from "../../config/logger.js";
import {
  paymentsInitialized,
  paymentsSubmitted,
  paymentsConfirmed,
  paymentsFailed,
} from "../../config/metrics.js";

/**
 * Resolve the item, its creator, and the settlement destination wallet for a
 * purchase. Shared by initializePayment and the pre-flight endpoint so both
 * look up the same destination the same way.
 */
const resolvePaymentDestination = async ({ itemType, itemId, session }) => {
  const Model = itemType === "book" ? Book : Course;
  const populateField = itemType === "book" ? "author" : "createdBy";

  const query = Model.findById(itemId).populate(populateField, "stellarWallet name");
  const item = session ? await query.session(session) : await query;

  if (!item) {
    return { error: { status: 404, message: `${itemType} not found` } };
  }

  const creator = itemType === "book" ? item.author : item.createdBy;
  const platformCollectEnabled = process.env.PLATFORM_COLLECT_ENABLED === "true";
  let destinationPublicKey;
  let settlementMode = "direct";

  if (!creator?.stellarWallet?.publicKey) {
    if (!platformCollectEnabled) {
      return {
        error: {
          status: 400,
          message: "Creator has not connected their Stellar wallet yet",
        },
      };
    }

    const platformWalletKey =
      process.env.PLATFORM_WALLET_PUBLIC_KEY || PLATFORM_WALLET_PUBLIC_KEY;
    if (!platformWalletKey) {
      return {
        error: {
          status: 500,
          message: "Platform wallet is not configured for platform-collect mode",
        },
      };
    }

    destinationPublicKey = platformWalletKey;
    settlementMode = "platform_collect";
  } else {
    destinationPublicKey = creator.stellarWallet.publicKey;
  }

  return { item, creator, destinationPublicKey, settlementMode };
};

/**
 * Platform memo convention: purchases are tagged DNB-<ITEMTYPE>-<last 8 chars
 * of the Mongo item id>, always as a text memo. This is always non-empty, so
 * it already satisfies SEP-29 "some memo present" destinations; it does not
 * substitute for a destination-specific memo (e.g. an exchange deposit id).
 */
const buildPurchaseMemo = (itemType, itemId) =>
  `DNB-${itemType.toUpperCase()}-${itemId.toString().slice(-8)}`;

/**
 * Get a quote for paying with a non-USDC asset via path payment
 * POST /api/stellar/payment/quote
 */
export const getQuote = async (req, res) => {
  try {
    const { itemType, itemId, sendAssetCode, sendAssetIssuer } = req.body;

    if (!["book", "course"].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'book' or 'course'",
      });
    }

    const Model = itemType === "book" ? Book : Course;
    const item = await Model.findById(itemId);

    if (!item) {
      return res.status(404).json({
        success: false,
        message: `${itemType} not found`,
      });
    }

    if (!item.price || item.price === 0) {
      return res.status(400).json({
        success: false,
        message: "This item is free, no quote needed",
      });
    }

    if (sendAssetCode && !sendAssetIssuer && sendAssetCode !== "XLM" && sendAssetCode !== "native") {
      return res.status(400).json({
        success: false,
        message: "Non-native assets require an issuer. Omit sendAssetIssuer only for native XLM.",
      });
    }

    const sendAsset = sendAssetIssuer
      ? new StellarSdk.Asset(sendAssetCode, sendAssetIssuer)
      : StellarSdk.Asset.native();

    const destAmount = item.price.toString();
    const paths = await findPaymentPaths(sendAsset, destAmount);

    if (!paths || paths.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No payment path found for the given asset",
      });
    }

    const bestPath = paths[0];
    const slippageBps = Math.min(
      500,
      Math.max(10, Number(req.body.slippageBps) || 100)
    );
    const sendMax = applySlippage(bestPath.source_amount, slippageBps);

    const sourceAsset = {
      asset_type: bestPath.source_asset_type,
      ...(bestPath.source_asset_type !== "native" && {
        asset_code: bestPath.source_asset_code,
        asset_issuer: bestPath.source_asset_issuer,
      }),
    };

    const pathAssets = (bestPath.path || []).map((a) => ({
      asset_type: a.asset_type,
      ...(a.asset_type !== "native" && {
        asset_code: a.asset_code,
        asset_issuer: a.asset_issuer,
      }),
    }));

    const expiresAt = new Date(Date.now() + 30 * 1000).toISOString();

    res.status(200).json({
      success: true,
      quote: {
        source_asset: sourceAsset,
        source_amount: bestPath.source_amount,
        destination_asset: { asset_type: "credit_alphanum4", asset_code: "USDC", asset_issuer: USDC.getIssuer() },
        destination_amount: destAmount,
        path: pathAssets,
        sendMax,
        slippageBps,
        expiresAt,
        note: "Quote is an estimate. The on-chain bound enforced is sendMax, not the quoted source_amount.",
      },
    });
  } catch (error) {
    logger.error("Quote error:", error);
    if (
      error.message?.includes("Invalid asset") ||
      error.message?.includes("bad asset")
    ) {
      return res.status(400).json({
        success: false,
        message: "Unknown or invalid asset",
      });
    }
    res.status(500).json({
      success: false,
      message: "Failed to get quote",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Run pre-flight payment safety checks (destination existence, USDC
 * trustline, source balance/reserve, SEP-29 memo-required) before the
 * frontend prompts the wallet to sign anything.
 * POST /api/stellar/payment/preflight
 */
export const getPaymentPreflight = async (req, res) => {
  try {
    const buyerId = req.user._id;
    const { itemType, itemId } = req.body;

    if (!["book", "course"].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'book' or 'course'",
      });
    }

    const buyer = await User.findById(buyerId);
    if (!buyer?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    const resolved = await resolvePaymentDestination({ itemType, itemId });
    if (resolved.error) {
      return res.status(resolved.error.status).json({
        success: false,
        message: resolved.error.message,
      });
    }

    const { item, destinationPublicKey, settlementMode } = resolved;

    if (!item.price || item.price === 0) {
      return res.status(400).json({
        success: false,
        message: "This item is free, no payment required",
      });
    }

    const memo = buildPurchaseMemo(itemType, itemId);
    const feeSplitPreview =
      settlementMode === "direct" ? calculateFeeSplit(item.price) : null;

    const preflight = await preflightPayment({
      sourcePublicKey: buyer.stellarWallet.publicKey,
      destinationPublicKey,
      amount: item.price.toString(),
      memo,
      operationCount: feeSplitPreview ? 2 : 1,
    });

    res.status(200).json({
      success: true,
      preflight,
    });
  } catch (error) {
    logger.error("Payment preflight error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to run payment pre-flight checks",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Initialize a payment - creates pending transaction and returns XDR to sign
 * POST /api/stellar/payment/initialize
 */
export const initializePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const buyerId = req.user._id;
    const { itemType, itemId, buyerWallet, sendAsset: sendAssetInput, sendMax, path: pathInput } = req.body;

    // Validate item type
    if (!["book", "course"].includes(itemType)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'book' or 'course'",
      });
    }

    // Get buyer info
    const buyer = await User.findById(buyerId).session(session);
    if (!buyer?.stellarWallet?.publicKey) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    // Verify wallet matches
    if (buyer.stellarWallet.publicKey !== buyerWallet) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Wallet mismatch. Please reconnect your wallet.",
      });
    }

    // Get item details and resolve the settlement destination
    const resolved = await resolvePaymentDestination({ itemType, itemId, session });
    if (resolved.error) {
      await session.abortTransaction();
      return res.status(resolved.error.status).json({
        success: false,
        message: resolved.error.message,
      });
    }

    const { item, creator, destinationPublicKey, settlementMode } = resolved;

    // Check if item is free
    if (!item.price || item.price === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "This item is free, no payment required",
      });
    }

    // Check if already purchased
    const purchasedArray =
      itemType === "book" ? buyer.purchasedBooks : buyer.purchasedCourses;
    const idField = itemType === "book" ? "bookId" : "courseId";
    const alreadyPurchased = purchasedArray?.some(
      (p) => p[idField]?.toString() === itemId
    );

    if (alreadyPurchased) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `You already own this ${itemType}`,
      });
    }

    // Check for existing pending transaction
    const existingTx = await Transaction.findOne({
      buyer: buyerId,
      itemType,
      itemId,
      status: { $in: ["pending", "submitted"] },
    }).session(session);

    if (existingTx) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "You have a pending transaction for this item",
        transactionId: existingTx._id,
      });
    }

    // Generate unique memo for this transaction
    const memo = buildPurchaseMemo(itemType, itemId);

    const hasTrustline = await hasUsdcTrustline(destinationPublicKey);
    let paymentTx;
    let fallback = null;

    if (hasTrustline || settlementMode === "platform_collect") {
      paymentTx = await buildPaymentTransaction({
        sourcePublicKey: buyer.stellarWallet.publicKey,
        destinationPublicKey,
        amount: item.price.toString(),
        memo,
        applyPlatformFee: settlementMode === "direct",
      });
    } else {
      fallback = "claimable_balance";
      settlementMode = "claimable_balance";
      paymentTx = await buildCreateClaimableBalanceTx({
        sourcePublicKey: buyer.stellarWallet.publicKey,
        claimantPublicKey: destinationPublicKey,
        amount: item.price.toString(),
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      });
    }

      if (!preflight.ok) {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: "Payment failed pre-flight safety checks",
          reasons: preflight.reasons,
        });
      }

      paymentTx = await buildPaymentTransaction({
        sourcePublicKey: buyer.stellarWallet.publicKey,
        destinationPublicKey,
        amount: item.price.toString(),
        memo,
        applyPlatformFee: settlementMode === "direct",
      });

      sep7Uri = buildSep7Uri({
        destination: destinationPublicKey,
        amount: item.price.toString(),
        memo,
      });
    }

    const feeSplit = paymentTx.feeSplit;

    // Create pending transaction record
    const transaction = new Transaction({
      buyer: buyerId,
      buyerWallet: buyer.stellarWallet.publicKey,
      creator: creator._id,
      creatorWallet: destinationPublicKey,
      itemType,
      itemId,
      itemTypeModel: itemType === "book" ? "Book" : "Course",
      itemTitle: item.title,
      amount: item.price.toString(),
      network: NETWORK,
      status: "pending",
      settlement: settlementMode,
      stellarTxHash: paymentTx.hash,
      ...(sendAssetInput && {
        sendAsset: sendAssetInput,
        sendMax,
      }),
      ...(feeSplit && {
        platformFee: {
          feePercent: feeSplit.feePercent,
          platformWallet: feeSplit.platformWallet,
          platformAmount: feeSplit.platformAmount,
          creatorAmount: feeSplit.creatorAmount,
        },
      }),
    });

    await transaction.save({ session });
    await session.commitTransaction();
    paymentsInitialized.inc({ type: "purchase" });

    logger.info(
      `Payment initialized: ${transaction._id} for ${itemType} ${itemId}`
    );

    res.status(200).json({
      success: true,
      transactionId: transaction._id,
      fallback,
      payment: {
        xdr: paymentTx.xdr,
        networkPassphrase: paymentTx.networkPassphrase,
        expectedHash: paymentTx.hash,
      },
      ...(sep7Uri && { sep7Uri }),
      ...(isPathPayment && {
        pathPaymentNote:
          "Path payment XDR provided. SEP-7 URI is not available for path payments; use the XDR signing flow.",
      }),
      item: {
        title: item.title,
        price: item.price,
        type: itemType,
      },
      creator: {
        name: creator.name,
        wallet: creator.stellarWallet.publicKey,
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Initialize payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize payment",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Submit signed transaction
 * POST /api/stellar/payment/submit
 */
export const submitPayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { transactionId, signedXdr } = req.body;
    const buyerId = req.user._id;

    if (!transactionId || !signedXdr) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Transaction ID and signed XDR are required",
      });
    }

    // Find the pending transaction
    const transaction = await Transaction.findOne({
      _id: transactionId,
      buyer: buyerId,
      status: "pending",
    }).session(session);

    if (!transaction) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: "Transaction not found or already processed",
      });
    }

    // Update status to submitted
    transaction.status = "submitted";
    transaction.submittedAt = new Date();
    await transaction.save({ session });
    paymentsSubmitted.inc({ type: "purchase" });

    // Submit to Stellar network
    let result;
    try {
      result = await submitTransaction(signedXdr);
    } catch (stellarError) {
      // Handle Stellar submission errors
      transaction.status = "failed";
      transaction.failureReason = stellarError.message;
      await transaction.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "purchase", reason: "stellar_error" });

      logger.error(`Transaction ${transactionId} failed:`, stellarError);

      return res.status(400).json({
        success: false,
        message: "Transaction failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Verify on-chain that the creator (and platform, when a fee was applied)
    // actually received the expected USDC amounts
    let verified = false;
    let failureReason = "";

    if (transaction.settlement === "claimable_balance") {
      const verification = await verifyTransaction(result.hash);
      if (!verification.exists || !verification.successful) {
        verified = false;
        failureReason = "On-chain verification failed";
      } else {
        verified = true;
        transaction.balanceId = await resolveBalanceId(result.hash);
      }
    } else {
      const expectedPayments = transaction.platformFee?.platformAmount
        ? [
            {
              destination: transaction.creatorWallet,
              amount: transaction.platformFee.creatorAmount,
            },
            {
              destination: transaction.platformFee.platformWallet,
              amount: transaction.platformFee.platformAmount,
            },
          ]
        : [
            {
              destination: transaction.creatorWallet,
              amount: transaction.amount,
            },
          ];

      const verification = await verifyPaymentOperations(
        result.hash,
        expectedPayments
      );
      verified = verification.verified;
      if (!verified) {
        failureReason = verification.reason;
      }
    }

    if (!verified) {
      transaction.status = "failed";
      transaction.failureReason = `On-chain verification failed: ${failureReason}`;
      transaction.stellarTxHash = result.hash;
      await transaction.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "purchase", reason: "verification_failed" });

      logger.error(
        `Transaction ${transactionId} verification failed: ${failureReason}`
      );

      return res.status(400).json({
        success: false,
        message: "Payment could not be verified on the Stellar network",
        error: failureReason,
      });
    }

    // Update transaction with Stellar response
    transaction.stellarTxHash = result.hash;
    transaction.stellarLedger = result.ledger;
    transaction.status = "confirmed";
    transaction.confirmedAt = new Date();
    await transaction.save({ session });
    paymentsConfirmed.inc({ type: "purchase" });

    // Record earnings for educator balance & ledger (idempotent per stellarTxHash)
    await recordSaleEarnings(transaction, { session });

    // Grant access to the purchased item
    const buyer = await User.findById(buyerId).session(session);

    if (transaction.itemType === "book") {
      buyer.purchasedBooks.push({
        bookId: transaction.itemId,
        purchaseDate: new Date(),
      });
      if (buyer.stat) {
        buyer.stat.booksRead = (buyer.stat.booksRead || 0) + 1;
      }
    } else {
      buyer.purchasedCourses.push({
        courseId: transaction.itemId,
        purchaseDate: new Date(),
      });
      if (buyer.stat) {
        buyer.stat.coursesEnrolled = (buyer.stat.coursesEnrolled || 0) + 1;
      }

      // Also add to course's enrolledUsers
      await Course.findByIdAndUpdate(
        transaction.itemId,
        { $addToSet: { enrolledUsers: buyerId } },
        { session }
      );
    }

    await buyer.save({ session });
    await enqueue(
      "generateReceipt",
      { transactionId: transaction._id.toString() },
      {
        attempts: 5,
        backoffMs: 1000,
        idempotencyKey: `receipt:${result.hash}`,
        session,
      }
    );
    await session.commitTransaction();

    logger.info(
      `Payment successful: ${transactionId}, Stellar TX: ${result.hash}`
    );

    res.status(200).json({
      success: true,
      message: "Payment successful!",
      transaction: {
        id: transaction._id,
        hash: result.hash,
        ledger: result.ledger,
        itemTitle: transaction.itemTitle,
        amount: transaction.amount,
        explorerUrl: getExplorerUrl(result.hash),
      },
    });
  } catch (error) {
    await session.abortTransaction();
    logger.error("Submit payment error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to process payment",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  } finally {
    session.endSession();
  }
};

/**
 * Get transaction history for a user
 * GET /api/stellar/payment/transactions
 */
export const getTransactionHistory = async (req, res) => {
  try {
    const userId = req.user._id;
    const { role = "buyer", page = 1, limit = 20 } = req.query;

    const query =
      role === "creator" ? { creator: userId } : { buyer: userId };

    const transactions = await Transaction.find(query)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .populate("buyer", "name avatar")
      .populate("creator", "name avatar");

    const total = await Transaction.countDocuments(query);

    // Add explorer URLs
    const transactionsWithUrls = transactions.map((tx) => ({
      ...tx.toObject(),
      explorerUrl:
        tx.status === "confirmed" ? getExplorerUrl(tx.stellarTxHash) : null,
    }));

    res.status(200).json({
      success: true,
      transactions: transactionsWithUrls,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    logger.error("Get transaction history error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transactions",
    });
  }
};

/**
 * Get single transaction details
 * GET /api/stellar/payment/transactions/:transactionId
 */
export const getTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user._id;

    const transaction = await Transaction.findOne({
      _id: transactionId,
      $or: [{ buyer: userId }, { creator: userId }],
    })
      .populate("buyer", "name avatar")
      .populate("creator", "name avatar");

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // If confirmed, verify on Stellar
    let stellarVerification = null;
    if (transaction.status === "confirmed") {
      try {
        stellarVerification = await verifyTransaction(
          transaction.stellarTxHash
        );
      } catch (error) {
        logger.warn(
          `Failed to verify transaction ${transactionId}:`,
          error
        );
      }
    }

    res.status(200).json({
      success: true,
      transaction: {
        ...transaction.toObject(),
        explorerUrl:
          transaction.status === "confirmed"
            ? getExplorerUrl(transaction.stellarTxHash)
            : null,
      },
      stellarVerification,
    });
  } catch (error) {
    logger.error("Get transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch transaction",
    });
  }
};

/**
 * Cancel a pending transaction
 * DELETE /api/stellar/payment/transactions/:transactionId
 */
export const cancelTransaction = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const userId = req.user._id;

    const transaction = await Transaction.findOneAndUpdate(
      {
        _id: transactionId,
        buyer: userId,
        status: "pending",
      },
      {
        status: "expired",
        failureReason: "Cancelled by user",
      },
      { new: true }
    );

    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found or cannot be cancelled",
      });
    }

    logger.info(`Transaction ${transactionId} cancelled by user ${userId}`);

    res.status(200).json({
      success: true,
      message: "Transaction cancelled",
    });
  } catch (error) {
    logger.error("Cancel transaction error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to cancel transaction",
    });
  }
};
