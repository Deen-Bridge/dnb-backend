import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import Transaction from "../../models/Transaction.js";
import UnreconciledPayment from "../../models/UnreconciledPayment.js";
import { recordSaleEarnings } from "../payoutService.js";
import { toStroops, USDC_ISSUER, verifyPaymentOperations, DONATION_WALLET_PUBLIC_KEY } from "./stellarService.js";
import logger from "../../config/logger.js";

const DONATION_MEMO = "DNB-SADAQAH";

const PURCHASE_MEMO_RE = /^DNB-(BOOK|COURSE)-([A-Fa-f0-9]+)$/;

export const grantItemAccess = async ({ buyerId, itemType, itemId, session }) => {
  const buyer = await User.findById(buyerId).session(session || null);

  if (itemType === "book") {
    buyer.purchasedBooks.push({
      bookId: itemId,
      purchaseDate: new Date(),
    });
    if (buyer.stat) {
      buyer.stat.booksRead = (buyer.stat.booksRead || 0) + 1;
    }
  } else {
    buyer.purchasedCourses.push({
      courseId: itemId,
      purchaseDate: new Date(),
    });
    if (buyer.stat) {
      buyer.stat.coursesEnrolled = (buyer.stat.coursesEnrolled || 0) + 1;
    }
    await Course.findByIdAndUpdate(
      itemId,
      { $addToSet: { enrolledUsers: buyerId } },
      { session: session || null }
    );
  }

  await buyer.save({ session: session || null });
};

const buildExpectedPayments = (transaction) =>
  transaction.platformFee?.platformAmount
    ? [
        { destination: transaction.creatorWallet, amount: transaction.platformFee.creatorAmount },
        { destination: transaction.platformFee.platformWallet, amount: transaction.platformFee.platformAmount },
      ]
    : [
        { destination: transaction.creatorWallet, amount: transaction.amount },
      ];

const promoteTransaction = async (transaction, paymentRecord) => {
  transaction.stellarTxHash = paymentRecord.transaction_hash;
  transaction.stellarLedger = paymentRecord.ledger || undefined;
  transaction.status = "confirmed";
  transaction.confirmedAt = new Date();
  transaction.expiresAt = undefined; // terminal state — never TTL-reapable
  await transaction.save();

  await recordSaleEarnings(transaction);
  await grantItemAccess({
    buyerId: transaction.buyer,
    itemType: transaction.itemType,
    itemId: transaction.itemId,
  });

  logger.info(
    { txHash: paymentRecord.transaction_hash, txId: transaction._id },
    "Reconciled and confirmed pending transaction from on-chain data"
  );
};

const createConfirmedDonation = async ({ sourceAccount, amount, hash, memo }) => {
  const user = await User.findOne({ "stellarWallet.publicKey": sourceAccount });
  if (!user) {
    return null;
  }

  const donation = new Transaction({
    type: "donation",
    buyer: user._id,
    buyerWallet: sourceAccount,
    creatorWallet: DONATION_WALLET_PUBLIC_KEY,
    amount: amount.toString(),
    network: process.env.STELLAR_NETWORK || "testnet",
    status: "confirmed",
    stellarTxHash: hash,
    confirmedAt: new Date(),
    // Terminal state: the conditional schema default omits expiresAt, and the
    // pre-save hook enforces it — an already-confirmed row must never carry a
    // TTL deadline.
    expiresAt: undefined,
  });

  await donation.save();
  logger.info(
    { txHash: hash, donationId: donation._id },
    "Created confirmed donation from on-chain payment"
  );
  return donation;
};

const createConfirmedPurchase = async ({ sourceAccount, amount, hash, memo, itemType, itemId }) => {
  const user = await User.findOne({ "stellarWallet.publicKey": sourceAccount });
  if (!user) {
    return null;
  }

  const Model = itemType === "book" ? Book : Course;
  const item = await Model.findById(itemId);
  if (!item) {
    return null;
  }

  const itemAmount = toStroops(amount);
  const expectedAmount = toStroops(item.price.toString());
  if (itemAmount < expectedAmount) {
    return null;
  }

  const creator = itemType === "book" ? item.author : item.createdBy;

  const purchase = new Transaction({
    buyer: user._id,
    buyerWallet: sourceAccount,
    creator: creator?._id,
    creatorWallet: creator?.stellarWallet?.publicKey || "",
    itemType,
    itemId,
    itemTypeModel: itemType === "book" ? "Book" : "Course",
    itemTitle: item.title,
    amount: item.price.toString(),
    network: process.env.STELLAR_NETWORK || "testnet",
    status: "confirmed",
    stellarTxHash: hash,
    confirmedAt: new Date(),
    // Terminal state: the conditional schema default omits expiresAt, and the
    // pre-save hook enforces it — an already-confirmed row must never carry a
    // TTL deadline.
    expiresAt: undefined,
  });

  await purchase.save();
  await grantItemAccess({
    buyerId: user._id,
    itemType,
    itemId,
  });

  logger.info(
    { txHash: hash, purchaseId: purchase._id },
    "Created confirmed purchase from on-chain payment"
  );
  return purchase;
};

export const matchByTxHash = async (txHash) => {
  return Transaction.findOne({
    stellarTxHash: txHash,
    status: { $in: ["pending", "submitted", "retrying"] },
  });
};

export const matchByMemo = async (memo, sourceAccount) => {
  if (!memo) return null;

  if (memo === DONATION_MEMO) {
    return { type: "donation", sourceAccount };
  }

  const match = memo.match(PURCHASE_MEMO_RE);
  if (match) {
    const itemType = match[1].toLowerCase();
    const itemIdSuffix = match[2];

    const transactions = await Transaction.find({
      itemType,
      status: { $in: ["pending", "submitted", "retrying"] },
    }).sort({ createdAt: -1 });

    for (const tx of transactions) {
      if (tx.itemId.toString().slice(-8).toLowerCase() === itemIdSuffix.toLowerCase()) {
        return tx;
      }
    }

    const Model = itemType === "book" ? Book : Course;
    const items = await Model.find({}).select("_id title price").lean();
    const matchedItem = items.find(
      (it) => it._id.toString().slice(-8).toLowerCase() === itemIdSuffix.toLowerCase()
    );
    if (matchedItem) {
      return { type: "purchase", itemType, itemId: matchedItem._id, itemPrice: matchedItem.price, sourceAccount };
    }
  }

  return null;
};

export const reconcilePayment = async (paymentRecord, txRecord) => {
  const assetCode = paymentRecord.asset_code || (paymentRecord.type === "path_payment_strict_receive" ? paymentRecord.destination_asset_code : null);
  const assetIssuer = paymentRecord.asset_issuer || (paymentRecord.type === "path_payment_strict_receive" ? paymentRecord.destination_asset_issuer : null);
  const amount = paymentRecord.amount || paymentRecord.destination_amount;

  if (assetCode !== "USDC" || assetIssuer !== USDC_ISSUER) {
    return;
  }

  const txHash = paymentRecord.transaction_hash;
  const memo = txRecord?.memo;
  const sourceAccount = txRecord?.source_account;

  const existingTx = await matchByTxHash(txHash);
  if (existingTx) {
    const expectedPayments = buildExpectedPayments(existingTx);
    const verification = await verifyPaymentOperations(txHash, expectedPayments);
    if (verification.verified) {
      await promoteTransaction(existingTx, paymentRecord);
      return;
    }
  }

  const memoMatch = await matchByMemo(memo, sourceAccount);
  if (memoMatch) {
    if (memoMatch.type === "donation") {
      const created = await createConfirmedDonation({
        sourceAccount,
        amount,
        hash: txHash,
        memo,
      });
      if (created) return;
    } else if (memoMatch.type === "purchase") {
      const created = await createConfirmedPurchase({
        sourceAccount,
        amount,
        hash: txHash,
        memo,
        itemType: memoMatch.itemType,
        itemId: memoMatch.itemId,
      });
      if (created) return;
    }
  }

  await UnreconciledPayment.findOneAndUpdate(
    { stellarTxHash: txHash },
    {
      $setOnInsert: {
        from: paymentRecord.from,
        to: paymentRecord.to,
        amount,
        memo: memo || null,
        sourceAccount: sourceAccount || null,
        reason: "No matching pending transaction or known user found",
      },
    },
    { upsert: true }
  );

  logger.warn(
    { txHash, memo: memo || "(none)" },
    "Unreconciled USDC payment — no matching pending transaction or user"
  );
};

export const getReconciliationStatus = async () => {
  const CursorModel = (await import("../../models/IngestionCursor.js")).default;
  const cursors = await CursorModel.find({}).lean();
  const unreconciledCount = await UnreconciledPayment.countDocuments();
  const confirmedByWorker = await Transaction.countDocuments({
    status: "confirmed",
    confirmedAt: { $exists: true },
  });
  return { cursors, unreconciledCount, confirmedByWorker };
};
