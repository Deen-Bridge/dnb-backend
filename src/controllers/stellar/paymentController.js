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
  PREFLIGHT_REASON_CODES,
  submitTransaction,
  verifyTransaction,
  verifyPaymentOperations,
  validateSignedPaymentXdr,
  findPaymentPaths,
  applySlippage,
  NETWORK,
  getExplorerUrl,
  USDC,
  PLATFORM_WALLET_PUBLIC_KEY,
} from "../../services/stellar/stellarService.js";
import { getAssetConfig, isAssetSupported, getSupportedCodes } from "../../config/assets.js";
import * as StellarSdk from "@stellar/stellar-sdk";
import { recordSaleEarnings } from "../../services/payoutService.js";
import { grantItemAccess } from "../../services/stellar/reconciliationService.js";
import { enqueue } from "../../jobs/queue.js";
import logger from "../../config/logger.js";
import {
  paymentsInitialized,
  paymentsSubmitted,
  paymentsConfirmed,
  paymentsFailed,
} from "../../config/metrics.js";
import { recordAudit } from "../../services/audit/auditService.js";
import { AUDIT_ACTIONS } from "../../models/AuditLog.js";
import { emitEvent, EVENT_TYPES } from "../../services/webhooks/webhookService.js";

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
          // The buyer can still complete the purchase through the
          // claimable-balance (gift) path instead of dead-ending.
          fallback: "claimable_balance",
        },
      };
    }

    const platformWalletKey = process.env.PLATFORM_WALLET_PUBLIC_KEY || PLATFORM_WALLET_PUBLIC_KEY;
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
 * Resolve the asset code an item is priced in, defaulting to USDC for
 * existing items with no currency set.
 */
const resolveItemCurrency = (item) => item.currency || "USDC";

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
 *
 * NOTE: path payments always settle in USDC regardless of the item's own
 * currency - that mechanism is issue #27's scope. Items priced in a
 * non-USDC currency (e.g. EURC) are rejected here rather than silently
 * treating item.price as a USDC amount.
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

    const itemAssetCode = resolveItemCurrency(item);
    if (itemAssetCode !== "USDC") {
      return res.status(400).json({
        success: false,
        message: `Path payment quotes are only available for USDC-priced items. This item is priced in ${itemAssetCode}; pay directly in ${itemAssetCode} instead.`,
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
 * Run pre-flight payment safety checks (destination existence, trustline
 * for the item's currency, source balance/reserve, SEP-29 memo-required)
 * before the frontend prompts the wallet to sign anything.
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
        ...(resolved.error.fallback && { fallback: resolved.error.fallback }),
      });
    }

    const { item, destinationPublicKey, settlementMode } = resolved;

    if (!item.price || item.price === 0) {
      return res.status(400).json({
        success: false,
        message: "This item is free, no payment required",
      });
    }

    const assetCode = resolveItemCurrency(item);
    if (!isAssetSupported(assetCode)) {
      return res.status(400).json({
        success: false,
        message: `This item is priced in an unsupported asset (${assetCode}). Supported: ${getSupportedCodes().join(", ")}`,
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
      assetCode,
    });

    // A destination without the asset trustline is exactly the case the
    // claimable-balance (gift) path fixes — surface it so the frontend can
    // route the buyer there instead of dead-ending on op_no_trust.
    const hasNoTrustline = preflight.reasons?.some(
      (r) => r.code === PREFLIGHT_REASON_CODES.DESTINATION_NO_TRUSTLINE
    );

    res.status(200).json({
      success: true,
      preflight,
      ...(hasNoTrustline && { fallback: "claimable_balance" }),
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

    if (!["book", "course"].includes(itemType)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'book' or 'course'",
      });
    }

    const buyer = await User.findById(buyerId).session(session);
    if (!buyer?.stellarWallet?.publicKey) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    if (buyer.stellarWallet.publicKey !== buyerWallet) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Wallet mismatch. Please reconnect your wallet.",
      });
    }

    const resolved = await resolvePaymentDestination({ itemType, itemId, session });
    if (resolved.error) {
      await session.abortTransaction();
      return res.status(resolved.error.status).json({
        success: false,
        message: resolved.error.message,
        ...(resolved.error.fallback && { fallback: resolved.error.fallback }),
      });
    }

    const { item, creator, destinationPublicKey, settlementMode } = resolved;

    if (!item.price || item.price === 0) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "This item is free, no payment required",
      });
    }

    const itemAssetCode = resolveItemCurrency(item);
    if (!isAssetSupported(itemAssetCode)) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: `This item is priced in an unsupported asset (${itemAssetCode}). Supported: ${getSupportedCodes().join(", ")}`,
      });
    }

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

    const memo = buildPurchaseMemo(itemType, itemId);

    const isPathPayment = sendAssetInput && sendMax;
    let paymentTx;
    let sep7Uri = null;
    // Currency actually settled on-chain: path payments always settle in
    // USDC (issue #27's mechanism); direct payments settle in the item's
    // own currency. Set explicitly in each branch below rather than
    // defaulting, so it's clear neither branch can silently fall through.
    let settledAssetCode;

    if (isPathPayment) {
      // Path payments always settle in USDC. Guard against an item priced
      // in a different asset, since destAmount below is item.price and
      // would otherwise be misinterpreted as a USDC amount.
      if (itemAssetCode !== "USDC") {
        await session.abortTransaction();
        return res.status(400).json({
          success: false,
          message: `Path payments are only available for USDC-priced items. This item is priced in ${itemAssetCode}; pay directly in ${itemAssetCode} instead.`,
        });
      }
      settledAssetCode = "USDC";

      const sendAsset = sendAssetInput.issuer
        ? new StellarSdk.Asset(sendAssetInput.code, sendAssetInput.issuer)
        : StellarSdk.Asset.native();

      const path = (pathInput || []).map((a) => ({
        asset_type: a.asset_type,
        ...(a.asset_type !== "native" && {
          asset_code: a.asset_code,
          asset_issuer: a.asset_issuer,
        }),
      }));

      paymentTx = await buildPathPaymentTransaction({
        sourcePublicKey: buyer.stellarWallet.publicKey,
        destinationPublicKey,
        destAmount: item.price.toString(),
        sendAsset,
        sendMax,
        path,
        memo,
        applyPlatformFee: settlementMode === "direct",
      });
    } else {
      settledAssetCode = itemAssetCode;
      const feeSplitPreview =
        settlementMode === "direct" ? calculateFeeSplit(item.price) : null;

      const preflight = await preflightPayment({
        sourcePublicKey: buyer.stellarWallet.publicKey,
        destinationPublicKey,
        amount: item.price.toString(),
        memo,
        operationCount: feeSplitPreview ? 2 : 1,
        assetCode: itemAssetCode,
      });

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
        assetCode: itemAssetCode,
      });

      sep7Uri = buildSep7Uri({
        destination: destinationPublicKey,
        amount: item.price.toString(),
        memo,
        assetCode: itemAssetCode,
      });
    }

    const feeSplit = paymentTx.feeSplit;
    const settledAssetConfig = getAssetConfig(settledAssetCode);

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
      currency: settledAssetCode,
      assetIssuer: settledAssetConfig?.issuer || null,
      network: NETWORK,
      status: "pending",
      settlement: settlementMode,
      expectedHash: paymentTx.hash,
      memo,
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

    recordAudit({
      action:     AUDIT_ACTIONS.PAYMENT_INITIALIZE,
      actor:      buyerId,
      req,
      targetType: "Transaction",
      targetId:   transaction._id.toString(),
      status:     "success",
      metadata:   {
        transactionId:  transaction._id.toString(),
        itemType,
        itemId,
        itemTitle:      item.title,
        amount:         item.price.toString(),
        settlementMode,
      },
    });

    // Fire-and-forget: emit AFTER the txn has committed (never inside it).
    await emitEvent(EVENT_TYPES.PAYMENT_INITIALIZED, {
      transactionId: transaction._id.toString(),
      itemType,
      itemId: itemId.toString(),
      itemTitle: item.title,
      amount: transaction.amount,
      currency: transaction.currency,
      network: transaction.network,
      settlement: settlementMode,
      buyerId: buyerId.toString(),
      creatorId: creator._id.toString(),
      status: "pending",
    });

    res.status(200).json({
      success: true,
      transactionId: transaction._id,
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

    // Build expected payments to validate XDR BEFORE submit
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

    // Validate signed XDR contents (memo, payments, optional source)
    try {
      validateSignedPaymentXdr(
        signedXdr,
        expectedPayments,
        transaction.memo,
        transaction.buyerWallet,
        true
      );
    } catch (validationError) {
      transaction.status = "failed";
      transaction.expiresAt = undefined;
      transaction.failureReason = `validation_failed: ${validationError.message}`;
      await transaction.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "purchase", reason: "validation_failed" });

      logger.error(`Transaction ${transactionId} validation failed:`, validationError.message);

      await emitEvent(EVENT_TYPES.PAYMENT_FAILED, {
        transactionId: transaction._id.toString(),
        itemType: transaction.itemType,
        itemId: transaction.itemId?.toString(),
        amount: transaction.amount,
        currency: transaction.currency,
        network: transaction.network,
        buyerId: buyerId.toString(),
        status: "failed",
        failureReason: `validation_failed: ${validationError.message}`,
      });

      return res.status(400).json({
        success: false,
        message: "Signed transaction does not match expected payment details",
        error: validationError.message,
      });
    }

    // Update status to submitted after validation
    transaction.status = "submitted";
    transaction.submittedAt = new Date();
    await transaction.save({ session });
    paymentsSubmitted.inc({ type: "purchase" });

    let result;
    try {
      result = await submitTransaction(signedXdr);
    } catch (stellarError) {
      transaction.status = "failed";
      transaction.expiresAt = undefined;
      transaction.failureReason = stellarError.message;
      await transaction.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "purchase", reason: "stellar_error" });

      logger.error(`Transaction ${transactionId} failed:`, stellarError);

      await emitEvent(EVENT_TYPES.PAYMENT_FAILED, {
        transactionId: transaction._id.toString(),
        itemType: transaction.itemType,
        itemId: transaction.itemId?.toString(),
        amount: transaction.amount,
        currency: transaction.currency,
        network: transaction.network,
        buyerId: buyerId.toString(),
        status: "failed",
        failureReason: stellarError.message,
      });

      return res.status(400).json({
        success: false,
        message: "Transaction failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Verify on-chain that the creator (and platform, when a fee was applied)
    // actually received the expected USDC amounts
    // (expectedPayments already defined above for pre-submission validation)

    const verification = await verifyPaymentOperations(
      result.hash,
      expectedPayments,
      transaction.currency || "USDC"
    );

    if (!verification.verified) {
      transaction.stellarTxHash = result.hash;
      if (verification.transient) {
        transaction.status = "retrying";
        transaction.failureReason = verification.reason;
        await transaction.save({ session });
        try {
          await enqueue(
            "verifyPaymentOnChain",
            { transactionId: transaction._id.toString() },
            {
              attempts: 5,
              backoffMs: 1000,
              idempotencyKey: `verify:${result.hash}`,
              session,
            }
          );
        } catch (enqueueErr) {
          // Don't let a queue outage roll back the on-chain-verified
          // "retrying" status - a sweeper can still reconcile this later
          // from stellarTxHash even if scheduling the retry job failed.
          logger.error(
            `Failed to enqueue verifyPaymentOnChain for transaction ${transaction._id}:`,
            enqueueErr
          );
        }
        await session.commitTransaction();
        return res.status(202).json({
          success: true,
          message: "Payment submitted; confirmation is in progress",
          transactionId: transaction._id,
          txHash: result.hash,
          status: "retrying",
        });
      }
      transaction.status = "failed";
      transaction.expiresAt = undefined;
      transaction.failureReason = `On-chain verification failed: ${verification.reason}`;
      await transaction.save({ session });
      await session.commitTransaction();
      paymentsFailed.inc({ type: "purchase", reason: "verification_failed" });

      logger.error(
        `Transaction ${transactionId} verification failed: ${verification.reason}`
      );

      recordAudit({
        action:     AUDIT_ACTIONS.PAYMENT_SUBMIT_FAILED,
        actor:      buyerId,
        req,
        targetType: "Transaction",
        targetId:   transactionId,
        status:     "failure",
        metadata:   {
          transactionId,
          stellarTxHash: result.hash,
          failureReason:  `On-chain verification failed: ${verification.reason}`,
        },
      });

      await emitEvent(EVENT_TYPES.PAYMENT_FAILED, {
        transactionId: transaction._id.toString(),
        itemType: transaction.itemType,
        itemId: transaction.itemId?.toString(),
        amount: transaction.amount,
        currency: transaction.currency,
        network: transaction.network,
        stellarTxHash: result.hash,
        buyerId: buyerId.toString(),
        status: "failed",
        failureReason: `On-chain verification failed: ${verification.reason}`,
      });

      return res.status(400).json({
        success: false,
        message: "Payment could not be verified on the Stellar network",
        error: verification.reason,
      });
    }

    transaction.stellarTxHash = result.hash;
    transaction.stellarLedger = result.ledger;
    transaction.status = "confirmed";
    transaction.confirmedAt = new Date();
    transaction.expiresAt = undefined; // terminal state — never TTL-reapable
    await transaction.save({ session });
    paymentsConfirmed.inc({ type: "purchase" });

    await recordSaleEarnings(transaction, { session });

    // Grant access to the purchased item (shared with ingestion worker)
    await grantItemAccess({
      buyerId,
      itemType: transaction.itemType,
      itemId: transaction.itemId,
      session,
    });
    try {
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
    } catch (enqueueErr) {
      // Don't let a queue outage roll back a payment that's already
      // confirmed on-chain (earnings recorded, access granted) - the
      // receipt can be regenerated later; the purchase itself must stand.
      logger.error(
        `Failed to enqueue generateReceipt for transaction ${transaction._id}:`,
        enqueueErr
      );
    }
    await session.commitTransaction();

    logger.info(
      `Payment successful: ${transactionId}, Stellar TX: ${result.hash}`
    );

    recordAudit({
      action:     AUDIT_ACTIONS.PAYMENT_SUBMIT_CONFIRMED,
      actor:      buyerId,
      req,
      targetType: "Transaction",
      targetId:   transactionId,
      status:     "success",
      metadata:   {
        transactionId,
        stellarTxHash:  result.hash,
        stellarLedger:  result.ledger,
        amount:         transaction.amount,
        itemType:       transaction.itemType,
        itemId:         transaction.itemId?.toString(),
        settlementMode: transaction.settlement,
      },
    });

    // Fire-and-forget: emit AFTER the txn commit above.
    await emitEvent(EVENT_TYPES.PAYMENT_CONFIRMED, {
      transactionId: transaction._id.toString(),
      itemType: transaction.itemType,
      itemId: transaction.itemId?.toString(),
      itemTitle: transaction.itemTitle,
      amount: transaction.amount,
      currency: transaction.currency,
      network: transaction.network,
      settlement: transaction.settlement,
      stellarTxHash: result.hash,
      stellarLedger: result.ledger,
      buyerId: buyerId.toString(),
      creatorId: transaction.creator?.toString(),
      status: "confirmed",
    });

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
        $set: {
          status: "expired",
          failureReason: "Cancelled by user",
        },
        $unset: {
          expiresAt: 1,
        },
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

    recordAudit({
      action:     AUDIT_ACTIONS.PAYMENT_CANCEL,
      actor:      userId,
      req,
      targetType: "Transaction",
      targetId:   transactionId,
      status:     "success",
      metadata:   {
        transactionId,
        itemType:  transaction.itemType,
        itemId:    transaction.itemId?.toString(),
        amount:    transaction.amount,
        failureReason: "Cancelled by user",
      },
    });

    await emitEvent(EVENT_TYPES.PAYMENT_EXPIRED, {
      transactionId: transaction._id.toString(),
      itemType: transaction.itemType,
      itemId: transaction.itemId?.toString(),
      amount: transaction.amount,
      currency: transaction.currency,
      network: transaction.network,
      buyerId: userId.toString(),
      status: "expired",
      failureReason: "Cancelled by user",
    });

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