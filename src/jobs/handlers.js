import Transaction from "../models/Transaction.js";
import User from "../models/User.js";
import Course from "../models/Course.js";
import CourseProgress from "../models/CourseProgress.js";
import Notification from "../models/Notification.js";
import { deliverLocalSSENotification } from "../controllers/notificationController.js";
import { sendOtpEmail, sendReceiptEmail } from "../../services/emails/sendMail.js";
import { verifyPaymentOperations, getExplorerUrl } from "../services/stellar/stellarService.js";
import { recordSaleEarnings } from "../services/payoutService.js";
import { registerJob, enqueue } from "./queue.js";
import { markPledgeTransactionPaid } from "../services/pledgeService.js";

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
    transaction.expiresAt = undefined; // terminal state — never TTL-reapable
    transaction.failureReason = `On-chain verification failed: ${verification.reason}`;
    await transaction.save();
    return;
  }

  transaction.status = "confirmed";
  transaction.confirmedAt = new Date();
  transaction.expiresAt = undefined; // terminal state — never TTL-reapable
  transaction.failureReason = undefined;
  await transaction.save();

  if (transaction.type === "donation") {
    await markPledgeTransactionPaid(transaction, transaction.confirmedAt);
  }

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

registerJob("notifications.bulk", async ({ courseId, senderId, title, message, type }) => {
  const course = await Course.findById(courseId).select("enrolledUsers createdBy title");
  if (!course) return;

  const progressList = await CourseProgress.find({ course: courseId }).select("user");
  const progressUserIds = progressList.map((p) => p.user.toString());
  const enrolledUserIds = (course.enrolledUsers || []).map((u) => u.toString());

  const allRecipientIds = Array.from(new Set([...progressUserIds, ...enrolledUserIds])).filter(
    (uid) => uid !== senderId?.toString()
  );

  if (allRecipientIds.length === 0) return;

  const notifDocs = allRecipientIds.map((recipientId) => ({
    recipient: recipientId,
    sender: senderId,
    type: type || "course_update",
    title,
    message,
    data: { courseId: course._id },
    priority: "medium",
  }));

  const inserted = await Notification.insertMany(notifDocs);

  for (const notif of inserted) {
    try {
      deliverLocalSSENotification(notif.recipient, notif);
    } catch {
      // Non-critical SSE delivery error
    }
  }
});

export { expectedPaymentsFor, queueReceipt };
