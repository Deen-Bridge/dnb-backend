import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import { sendOtpEmail, sendReceiptEmail } from "../../services/emails/sendMail.js";
import { verifyPaymentOperations, getExplorerUrl } from "../services/stellar/stellarService.js";
import { recordSaleEarnings } from "../services/payoutService.js";
import { registerJob, enqueue } from "./queue.js";

const expectedPaymentsFor = (transaction) =>
  transaction.type === "donation"
    ? [{ destination: transaction.creatorWallet, amount: transaction.amount }]
    : transaction.platformFee?.platformAmount
      ? [
          { destination: transaction.creatorWallet, amount: transaction.platformFee.creatorAmount },
          { destination: transaction.platformFee.platformWallet, amount: transaction.platformFee.platformAmount },
        ]
      : [{ destination: transaction.creatorWallet, amount: transaction.amount }];

const queueReceipt = (transaction) =>
  enqueue(
    "generateReceipt",
    { transactionId: transaction._id.toString() },
    { attempts: 5, backoffMs: 1000, idempotencyKey: `receipt:${transaction.stellarTxHash}` }
  );

registerJob("sendOtpEmail", async ({ userId, otp }) => {
  const user = await User.findById(userId).select("email");
  if (!user) throw new Error("OTP recipient no longer exists");
  await sendOtpEmail(otp, user.email);
});

registerJob("verifyPaymentOnChain", async ({ transactionId }, context) => {
  const transaction = await Transaction.findById(transactionId);
  if (!transaction || transaction.status === "failed") return;
  if (transaction.status === "confirmed") {
    await queueReceipt(transaction);
    return;
  }

  const verification = await verifyPaymentOperations(
    transaction.stellarTxHash,
    expectedPaymentsFor(transaction)
  );
  if (!verification.verified) {
    transaction.retryCount = context.attempt;
    if (verification.transient && context.attempt < context.maxAttempts) {
      await transaction.save();
      throw new Error(verification.reason);
    }
    transaction.status = "failed";
    transaction.failureReason = `On-chain verification failed: ${verification.reason}`;
    await transaction.save();
    return;
  }

  transaction.status = "confirmed";
  transaction.confirmedAt = new Date();
  transaction.failureReason = undefined;
  await transaction.save();

  if (transaction.type === "purchase") {
    await recordSaleEarnings(transaction);
    const purchase = { purchaseDate: transaction.confirmedAt };
    if (transaction.itemType === "book") {
      purchase.bookId = transaction.itemId;
      await User.updateOne({ _id: transaction.buyer }, { $addToSet: { purchasedBooks: purchase } });
    } else {
      purchase.courseId = transaction.itemId;
      await User.updateOne({ _id: transaction.buyer }, { $addToSet: { purchasedCourses: purchase } });
      await Course.updateOne({ _id: transaction.itemId }, { $addToSet: { enrolledUsers: transaction.buyer } });
    }
  }
  await queueReceipt(transaction);
});

registerJob("generateReceipt", async ({ transactionId }) => {
  const transaction = await Transaction.findById(transactionId).populate("buyer", "email name");
  if (!transaction || transaction.status !== "confirmed") return;
  await sendReceiptEmail({
    email: transaction.buyer.email,
    name: transaction.buyer.name,
    title: transaction.itemTitle || "Sadaqah donation",
    amount: transaction.amount,
    currency: transaction.currency,
    platformAmount: transaction.platformFee?.platformAmount || "0",
    creatorAmount: transaction.platformFee?.creatorAmount || transaction.amount,
    txHash: transaction.stellarTxHash,
    explorerUrl: getExplorerUrl(transaction.stellarTxHash),
  });
});

export { expectedPaymentsFor, queueReceipt };
