// controllers/stellar/paymentController.js
import mongoose from "mongoose";
import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import Transaction from "../../models/Transaction.js";
import {
  buildPaymentTransaction,
  submitTransaction,
  verifyTransaction,
  NETWORK,
  getExplorerUrl,
} from "../../services/stellar/stellarService.js";
import logger from "../../config/logger.js";

/**
 * Initialize a payment - creates pending transaction and returns XDR to sign
 * POST /api/stellar/payment/initialize
 */
export const initializePayment = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const buyerId = req.user._id;
    const { itemType, itemId, buyerWallet } = req.body;

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

    // Get item details
    const Model = itemType === "book" ? Book : Course;
    const populateField = itemType === "book" ? "author" : "createdBy";

    const item = await Model.findById(itemId)
      .populate(populateField, "stellarWallet name")
      .session(session);

    if (!item) {
      await session.abortTransaction();
      return res.status(404).json({
        success: false,
        message: `${itemType} not found`,
      });
    }

    const creator = itemType === "book" ? item.author : item.createdBy;

    // Check creator has wallet
    if (!creator?.stellarWallet?.publicKey) {
      await session.abortTransaction();
      return res.status(400).json({
        success: false,
        message: "Creator has not connected their Stellar wallet yet",
      });
    }

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
    const memo = `DNB-${itemType.toUpperCase()}-${itemId.toString().slice(-8)}`;

    // Build the payment transaction
    const paymentTx = await buildPaymentTransaction({
      sourcePublicKey: buyer.stellarWallet.publicKey,
      destinationPublicKey: creator.stellarWallet.publicKey,
      amount: item.price.toString(),
      memo,
    });

    // Create pending transaction record
    const transaction = new Transaction({
      buyer: buyerId,
      buyerWallet: buyer.stellarWallet.publicKey,
      creator: creator._id,
      creatorWallet: creator.stellarWallet.publicKey,
      itemType,
      itemId,
      itemTypeModel: itemType === "book" ? "Book" : "Course",
      itemTitle: item.title,
      amount: item.price.toString(),
      network: NETWORK,
      status: "pending",
      stellarTxHash: paymentTx.hash, // Temporary hash, will be replaced with actual
    });

    await transaction.save({ session });
    await session.commitTransaction();

    logger.info(
      `Payment initialized: ${transaction._id} for ${itemType} ${itemId}`
    );

    res.status(200).json({
      success: true,
      transactionId: transaction._id,
      payment: {
        xdr: paymentTx.xdr,
        networkPassphrase: paymentTx.networkPassphrase,
        expectedHash: paymentTx.hash,
      },
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

      logger.error(`Transaction ${transactionId} failed:`, stellarError);

      return res.status(400).json({
        success: false,
        message: "Transaction failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Update transaction with Stellar response
    transaction.stellarTxHash = result.hash;
    transaction.stellarLedger = result.ledger;
    transaction.status = "confirmed";
    transaction.confirmedAt = new Date();
    await transaction.save({ session });

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
