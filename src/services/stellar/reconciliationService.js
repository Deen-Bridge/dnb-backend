import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import Transaction from "../../models/Transaction.js";
import UnreconciledPayment, { UNRECONCILED_REASON_CODES as REASONS } from "../../models/UnreconciledPayment.js";
import { recordSaleEarnings } from "../payoutService.js";
import { toStroops, USDC_ISSUER, verifyPaymentOperations, DONATION_WALLET_PUBLIC_KEY } from "./stellarService.js";
import { parsePaymentMemo } from "./paymentReference.js";
import { resolveStellarNetwork } from "../../config/stellar.js";
import {
  observeReconciliationLookup,
  recordAmbiguousReference,
  recordRejectedReference,
  recordUnreconciledPayment,
} from "../../config/metrics.js";
import logger from "../../config/logger.js";

// Reconciliation contract (issue #695, docs/payment-reconciliation.md):
//
//   1. A payment already recorded under its tx hash is resolved by that hash.
//   2. Otherwise its memo is parsed into a canonical reference, a legacy
//      suffix memo, the donation memo, or nothing.
//   3. Every lookup is an indexed equality match, capped at two rows (enough
//      to prove uniqueness) and bounded by maxTimeMS. There are no catalog
//      scans: an item is only ever fetched by the id on the matched checkout.
//   4. Zero or multiple matches, or any disagreement between the payment and
//      the checkout, fail closed into UnreconciledPayment with a reason code.
//   5. Promotion is a compare-and-set on status, so duplicate Horizon events
//      and concurrent workers settle a checkout exactly once.

const RECONCILABLE_STATUSES = Object.freeze(["pending", "submitted", "retrying"]);
const SETTLED_STATUSES = Object.freeze(["confirmed", "refunded", "disputed"]);

// Two rows are enough to tell "exactly one" from "ambiguous".
const LOOKUP_LIMIT = 2;
const DEFAULT_QUERY_TIMEOUT_MS = 2000;
// How long after a worker confirmation a replay may re-run follow-up effects.
const EFFECTS_GRACE_MS = 60 * 1000;

const queryTimeoutMs = () => {
  const configured = Number.parseInt(process.env.RECONCILIATION_QUERY_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_QUERY_TIMEOUT_MS;
};

const isDuplicateKeyError = (error) => error?.code === 11000;

const reject = (reasonCode, reason, transaction) => ({
  outcome: "rejected",
  reasonCode,
  reason,
  transactionId: transaction?._id,
});

/**
 * Grant the buyer access to a purchased item. Replays are harmless: an item
 * the buyer already owns is not pushed again and stats are not re-counted.
 */
export const grantItemAccess = async ({ buyerId, itemType, itemId, session }) => {
  const buyer = await User.findById(buyerId).session(session || null);
  if (!buyer) {
    throw new Error(`Cannot grant ${itemType} access: buyer ${buyerId} not found`);
  }

  const isBook = itemType === "book";
  const owned = isBook ? buyer.purchasedBooks : buyer.purchasedCourses;
  const idField = isBook ? "bookId" : "courseId";
  const alreadyOwned = owned?.some((entry) => entry[idField]?.toString() === itemId.toString());

  if (!isBook) {
    // $addToSet is already idempotent, so keep enrolment in sync either way.
    await Course.findByIdAndUpdate(
      itemId,
      { $addToSet: { enrolledUsers: buyerId } },
      { session: session || null }
    );
  }

  if (alreadyOwned) return;

  if (isBook) {
    buyer.purchasedBooks.push({ bookId: itemId, purchaseDate: new Date() });
    if (buyer.stat) {
      buyer.stat.booksRead = (buyer.stat.booksRead || 0) + 1;
    }
  } else {
    buyer.purchasedCourses.push({ courseId: itemId, purchaseDate: new Date() });
    if (buyer.stat) {
      buyer.stat.coursesEnrolled = (buyer.stat.coursesEnrolled || 0) + 1;
    }
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

/**
 * Normalise a Horizon payment record and its parent transaction into the
 * fields reconciliation cares about.
 */
const describePayment = (paymentRecord, txRecord) => {
  const isPathPayment = paymentRecord.type === "path_payment_strict_receive";
  // Only text memos can carry a reference; a hash/id memo is never ours.
  const memoIsText = !txRecord?.memo_type || txRecord.memo_type === "text";

  return {
    txHash: paymentRecord.transaction_hash,
    assetCode: paymentRecord.asset_code || (isPathPayment ? paymentRecord.destination_asset_code : null),
    assetIssuer: paymentRecord.asset_issuer || (isPathPayment ? paymentRecord.destination_asset_issuer : null),
    amount: paymentRecord.amount || paymentRecord.destination_amount,
    from: paymentRecord.from || null,
    to: paymentRecord.to || null,
    ledger: paymentRecord.ledger || txRecord?.ledger || undefined,
    memo: memoIsText ? txRecord?.memo || null : null,
    rawMemo: txRecord?.memo || null,
    sourceAccount: txRecord?.source_account || null,
  };
};

const payerOf = (payment) => payment.sourceAccount || payment.from;

// ---------------------------------------------------------------------------
// Bounded lookups. Each one is exported as a Query so tests can explain() it.
// ---------------------------------------------------------------------------

/** Rows already carrying this on-chain hash (unique index on stellarTxHash). */
export const buildTxHashQuery = (txHash) =>
  Transaction.find({ stellarTxHash: { $eq: txHash } }).limit(LOOKUP_LIMIT).maxTimeMS(queryTimeoutMs());

/** Checkout(s) minted with this canonical reference (unique partial index). */
export const buildCanonicalReferenceQuery = (reference) =>
  Transaction.find({ paymentReference: { $eq: reference, $type: "string" } })
    .limit(LOOKUP_LIMIT)
    .maxTimeMS(queryTimeoutMs());

/**
 * Open legacy checkout(s) for this exact suffix memo, scoped to the payer.
 * Two buyers can legitimately share a legacy memo (same item, or colliding
 * suffixes), so the payer is part of the identity.
 */
export const buildLegacyReferenceQuery = ({ memo, itemType, payer }) =>
  Transaction.find({
    memo: { $eq: memo },
    itemType: { $eq: itemType },
    status: { $in: RECONCILABLE_STATUSES },
    buyerWallet: { $eq: payer },
  })
    .limit(LOOKUP_LIMIT)
    .maxTimeMS(queryTimeoutMs());

/**
 * Pending/submitted/retrying checkout already bound to this hash.
 * Kept for callers that only care about open checkouts.
 */
export const matchByTxHash = async (txHash) =>
  Transaction.findOne({
    stellarTxHash: txHash,
    status: { $in: RECONCILABLE_STATUSES },
  }).maxTimeMS(queryTimeoutMs());

const resolveCanonical = async ({ itemType, reference }) => {
  const candidates = await buildCanonicalReferenceQuery(reference);

  if (candidates.length === 0) {
    return reject(REASONS.REFERENCE_NOT_FOUND, "No checkout was issued with this payment reference");
  }
  if (candidates.length > 1) {
    // Only reachable if the unique index is missing (e.g. mid-rollout).
    recordAmbiguousReference("canonical");
    return reject(
      REASONS.AMBIGUOUS_REFERENCE,
      "Payment reference matched more than one checkout; verify the paymentReference unique index exists"
    );
  }

  const [transaction] = candidates;
  if (transaction.type !== "purchase" || transaction.itemType !== itemType) {
    return reject(
      REASONS.ITEM_TYPE_MISMATCH,
      `Memo declares a ${itemType} purchase but the referenced checkout is a ${transaction.itemType || transaction.type}`,
      transaction
    );
  }
  return { outcome: "matched", transaction };
};

const resolveLegacy = async ({ memo, itemType }, payer) => {
  if (typeof payer !== "string" || payer.length === 0) {
    return reject(
      REASONS.REFERENCE_NOT_FOUND,
      "Legacy suffix memo cannot be attributed without a source account"
    );
  }

  const candidates = await buildLegacyReferenceQuery({ memo, itemType, payer });

  if (candidates.length === 0) {
    return reject(
      REASONS.REFERENCE_NOT_FOUND,
      "Legacy suffix memo has no open checkout for this payer; match it to an item manually"
    );
  }
  if (candidates.length > 1) {
    recordAmbiguousReference("legacy");
    return reject(
      REASONS.AMBIGUOUS_REFERENCE,
      "Legacy suffix memo matches several open checkouts for this payer; choose the intended one manually"
    );
  }
  return { outcome: "matched", transaction: candidates[0] };
};

/**
 * Resolve a memo to a single checkout (or the donation flow) without
 * touching anything. Returns `{ kind, outcome, transaction? , reasonCode? }`.
 *
 * @param {string|null} memo - text memo from the parent transaction
 * @param {string|null} payer - account that funded the payment
 */
export const resolvePaymentReference = async (memo, payer) => {
  const parsed = parsePaymentMemo(memo);

  switch (parsed.kind) {
    case "donation":
      return { kind: "donation", outcome: "matched" };
    case "canonical":
      return { kind: "canonical", ...(await resolveCanonical(parsed)) };
    case "legacy":
      return { kind: "legacy", ...(await resolveLegacy(parsed, payer)) };
    case "malformed":
      return {
        kind: "malformed",
        ...reject(REASONS.MALFORMED_REFERENCE, "Memo uses a DNB purchase prefix but is not a valid payment reference"),
      };
    default:
      return {
        kind: "none",
        ...reject(REASONS.NO_REFERENCE, "Payment carries no DeenBridge payment reference"),
      };
  }
};

const lookupOutcomeLabel = (resolution) => {
  if (resolution.outcome !== "rejected") return resolution.outcome;
  if (resolution.reasonCode === REASONS.AMBIGUOUS_REFERENCE) return "ambiguous";
  if (resolution.reasonCode === REASONS.REFERENCE_NOT_FOUND || resolution.reasonCode === REASONS.NO_REFERENCE) {
    return "not_found";
  }
  return "rejected";
};

/**
 * Find the checkout this payment belongs to: by hash first (cheap, and the
 * only path for submit-flow rows), then by memo reference.
 */
const resolveCandidate = async (payment) => {
  const startedAt = Date.now();
  let strategy = "tx_hash";
  let resolution;

  try {
    const recorded = await buildTxHashQuery(payment.txHash);
    if (recorded.length > 1) {
      // stellarTxHash is unique, so this means the index is missing.
      recordAmbiguousReference("canonical");
      resolution = {
        kind: "tx_hash",
        ...reject(REASONS.AMBIGUOUS_REFERENCE, "Transaction hash is recorded on more than one checkout"),
      };
    } else if (recorded.length === 1) {
      resolution = { kind: "tx_hash", outcome: "matched", transaction: recorded[0] };
    } else {
      resolution = await resolvePaymentReference(payment.memo, payerOf(payment));
      strategy = resolution.kind;
    }
  } catch (error) {
    observeReconciliationLookup(strategy, "error", Date.now() - startedAt);
    throw error;
  }

  observeReconciliationLookup(strategy, lookupOutcomeLabel(resolution), Date.now() - startedAt);
  return resolution;
};

// ---------------------------------------------------------------------------
// Validation: the payment must agree with the checkout on every axis before
// anything is created or promoted.
// ---------------------------------------------------------------------------

const ITEM_MODELS = Object.freeze({
  book: { Model: Book, name: "Book" },
  course: { Model: Course, name: "Course" },
});

const validateAgainstTransaction = async (transaction, payment) => {
  if (transaction.network !== resolveStellarNetwork()) {
    return reject(REASONS.NETWORK_MISMATCH, `Checkout was created on ${transaction.network}`, transaction);
  }

  const expectedAsset = transaction.currency || "USDC";
  if (
    payment.assetCode !== expectedAsset ||
    (transaction.assetIssuer && transaction.assetIssuer !== payment.assetIssuer)
  ) {
    return reject(REASONS.ASSET_MISMATCH, `Checkout expects ${expectedAsset} from its recorded issuer`, transaction);
  }

  const payers = [payment.sourceAccount, payment.from].filter(Boolean);
  if (payers.length === 0 || payers.some((account) => account !== transaction.buyerWallet)) {
    return reject(REASONS.SOURCE_MISMATCH, "Payment was not sent from the checkout's buyer wallet", transaction);
  }

  const expectedForDestination = buildExpectedPayments(transaction).filter(
    (expected) => expected.destination === payment.to
  );
  if (expectedForDestination.length === 0) {
    return reject(REASONS.DESTINATION_MISMATCH, "Payment destination is not part of this checkout", transaction);
  }
  const paidStroops = toStroops(payment.amount);
  if (!expectedForDestination.some((expected) => toStroops(expected.amount) === paidStroops)) {
    return reject(REASONS.AMOUNT_MISMATCH, "Payment amount does not match the checkout's expected amount", transaction);
  }

  if (transaction.type === "purchase") {
    const item = ITEM_MODELS[transaction.itemType];
    if (!item || transaction.itemTypeModel !== item.name) {
      return reject(REASONS.ITEM_TYPE_MISMATCH, "Checkout item type and model disagree", transaction);
    }
    const exists = await item.Model.exists({ _id: transaction.itemId }).maxTimeMS(queryTimeoutMs());
    if (!exists) {
      return reject(REASONS.ITEM_NOT_FOUND, `Purchased ${transaction.itemType} no longer exists`, transaction);
    }
  }

  return null;
};

/**
 * Decide what to do with a matched checkout. Pure apart from reads and the
 * Horizon verification call; nothing is written here.
 */
const decideForTransaction = async (transaction, payment) => {
  // A sponsored checkout stores the inner hash in stellarTxHash and the
  // fee-bump hash alongside; Horizon may report the payment under either.
  const isBoundPayment =
    transaction.stellarTxHash === payment.txHash || transaction.feeBumpTxHash === payment.txHash;

  if (SETTLED_STATUSES.includes(transaction.status)) {
    if (isBoundPayment) {
      return { outcome: "duplicate", transaction };
    }
    return reject(
      REASONS.REFERENCE_ALREADY_SETTLED,
      `Reference was already settled by another payment (status ${transaction.status}); possible double payment`,
      transaction
    );
  }

  if (!RECONCILABLE_STATUSES.includes(transaction.status)) {
    return reject(
      REASONS.TRANSACTION_NOT_RECONCILABLE,
      `Checkout is ${transaction.status}; it cannot be promoted automatically`,
      transaction
    );
  }

  if (transaction.stellarTxHash && !isBoundPayment) {
    return reject(
      REASONS.REFERENCE_HASH_MISMATCH,
      "Checkout is bound to a different submitted transaction hash",
      transaction
    );
  }

  const invalid = await validateAgainstTransaction(transaction, payment);
  if (invalid) return invalid;

  // Keep whichever hash the submit flow already bound (the inner hash for a
  // sponsored payment); otherwise this payment's hash becomes the record.
  const settledHash = transaction.stellarTxHash || payment.txHash;

  const verification = await verifyPaymentOperations(
    settledHash,
    buildExpectedPayments(transaction),
    transaction.currency || "USDC"
  );
  if (!verification.verified) {
    return verification.transient
      ? reject(REASONS.VERIFICATION_UNAVAILABLE, "On-chain verification was unavailable; replay once Horizon recovers", transaction)
      : reject(REASONS.VERIFICATION_FAILED, verification.reason || "On-chain operations did not match the checkout", transaction);
  }

  return { outcome: "confirm", transaction, settledHash };
};

const decideForDonation = async (payment) => {
  if (!DONATION_WALLET_PUBLIC_KEY || payment.to !== DONATION_WALLET_PUBLIC_KEY) {
    return reject(REASONS.DESTINATION_MISMATCH, "Donation memo used on a payment that did not reach the donation wallet");
  }

  const donor = await User.findOne({ "stellarWallet.publicKey": payerOf(payment) })
    .select("_id")
    .maxTimeMS(queryTimeoutMs());
  if (!donor) {
    return reject(REASONS.UNKNOWN_DONOR, "Donation source account is not linked to any user");
  }
  return { outcome: "donate", donorId: donor._id };
};

const decide = async (payment) => {
  const resolution = await resolveCandidate(payment);

  if (resolution.outcome === "rejected") {
    if (resolution.reasonCode !== REASONS.NO_REFERENCE) {
      recordRejectedReference(resolution.reasonCode);
    }
    return { ...resolution, referenceKind: resolution.kind };
  }

  const decision = resolution.kind === "donation"
    ? await decideForDonation(payment)
    : await decideForTransaction(resolution.transaction, payment);

  if (decision.outcome === "rejected") {
    recordRejectedReference(decision.reasonCode);
  }
  return { ...decision, referenceKind: resolution.kind };
};

// ---------------------------------------------------------------------------
// Writes.
// ---------------------------------------------------------------------------

const applySettlementEffects = async (transaction) => {
  if (transaction.type !== "purchase") return;
  await recordSaleEarnings(transaction);
  await grantItemAccess({
    buyerId: transaction.buyer,
    itemType: transaction.itemType,
    itemId: transaction.itemId,
  });
};

/**
 * Compare-and-set promotion: only a still-open checkout that is unbound or
 * bound to this very hash can be confirmed, so exactly one worker wins.
 */
const claimTransaction = (transaction, payment, settledHash) => {
  const now = new Date();
  return Transaction.findOneAndUpdate(
    {
      _id: transaction._id,
      status: { $in: RECONCILABLE_STATUSES },
      stellarTxHash: { $in: [null, settledHash] },
    },
    {
      $set: {
        stellarTxHash: settledHash,
        status: "confirmed",
        confirmedAt: now,
        reconciledAt: now,
        ...(payment.ledger && { stellarLedger: payment.ledger }),
      },
      // Terminal state — never TTL-reapable.
      $unset: { expiresAt: 1 },
    },
    { new: true }
  ).maxTimeMS(queryTimeoutMs());
};

const confirmTransaction = async (transaction, payment, settledHash) => {
  let claimed;
  try {
    claimed = await claimTransaction(transaction, payment, settledHash);
  } catch (error) {
    // Another row already owns this hash: the payment is recorded elsewhere.
    if (isDuplicateKeyError(error)) {
      return { outcome: "duplicate", transactionId: transaction._id };
    }
    throw error;
  }

  if (!claimed) {
    // Lost the race to a concurrent worker or the submit flow.
    return { outcome: "duplicate", transactionId: transaction._id };
  }

  await applySettlementEffects(claimed);
  logger.info(
    { txHash: payment.txHash, txId: claimed._id },
    "Reconciled and confirmed pending transaction from on-chain data"
  );
  return { outcome: "confirmed", transactionId: claimed._id };
};

/**
 * Replayed event for a row that is already settled. If the worker confirmed
 * it and the confirmation is old enough that its follow-up effects can no
 * longer be in flight, finish whatever a crash may have interrupted. The
 * grace window keeps a concurrent duplicate from racing the winning worker;
 * both effects are themselves replay-safe.
 */
const handleDuplicate = async (transaction) => {
  const confirmedByWorker = transaction.status === "confirmed" && transaction.reconciledAt;
  const settled = confirmedByWorker && Date.now() - transaction.reconciledAt.getTime() >= EFFECTS_GRACE_MS;
  if (settled) {
    await applySettlementEffects(transaction);
  }
  return { outcome: "duplicate", transactionId: transaction._id };
};

const createConfirmedDonation = async (payment, donorId) => {
  const donation = new Transaction({
    type: "donation",
    buyer: donorId,
    buyerWallet: payerOf(payment),
    creatorWallet: DONATION_WALLET_PUBLIC_KEY,
    amount: payment.amount.toString(),
    network: resolveStellarNetwork(),
    status: "confirmed",
    stellarTxHash: payment.txHash,
    stellarLedger: payment.ledger,
    confirmedAt: new Date(),
    reconciledAt: new Date(),
    // Terminal state: the conditional schema default omits expiresAt, and the
    // pre-save hook enforces it — an already-confirmed row must never carry a
    // TTL deadline.
    expiresAt: undefined,
  });

  try {
    await donation.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      return { outcome: "duplicate" };
    }
    throw error;
  }

  logger.info(
    { txHash: payment.txHash, donationId: donation._id },
    "Created confirmed donation from on-chain payment"
  );
  return { outcome: "confirmed", transactionId: donation._id };
};

const persistUnreconciled = async (payment, rejection) => {
  await UnreconciledPayment.findOneAndUpdate(
    { stellarTxHash: payment.txHash },
    {
      $setOnInsert: {
        from: payment.from,
        to: payment.to,
        amount: payment.amount,
        memo: payment.rawMemo,
        sourceAccount: payment.sourceAccount,
      },
      $set: {
        reason: rejection.reason,
        reasonCode: rejection.reasonCode,
        referenceKind: rejection.referenceKind || "none",
        lastSeenAt: new Date(),
        ...(rejection.transactionId && { transaction: rejection.transactionId }),
      },
      $inc: { attempts: 1 },
    },
    { upsert: true }
  );

  recordUnreconciledPayment(rejection.reasonCode);
  // Memo and wallet addresses stay out of logs; the row holds them for triage.
  logger.warn(
    { txHash: payment.txHash, reasonCode: rejection.reasonCode, referenceKind: rejection.referenceKind },
    "Unreconciled USDC payment persisted for manual review"
  );
};

const markResolved = (txHash) =>
  UnreconciledPayment.updateOne(
    { stellarTxHash: txHash, resolvedAt: null },
    { $set: { resolvedAt: new Date() } }
  );

/**
 * Reconcile one ingested Horizon payment record.
 *
 * @param {object} paymentRecord - Horizon `payments` record
 * @param {object|null} txRecord - parent Horizon transaction (memo, source)
 * @returns {Promise<{outcome: "ignored"|"confirmed"|"duplicate"|"rejected", reasonCode?: string, transactionId?: unknown}>}
 */
export const reconcilePayment = async (paymentRecord, txRecord) => {
  const payment = describePayment(paymentRecord, txRecord);

  if (payment.assetCode !== "USDC" || payment.assetIssuer !== USDC_ISSUER) {
    return { outcome: "ignored" };
  }

  let decision;
  try {
    decision = await decide(payment);
  } catch (error) {
    // Includes maxTimeMS expiry. Persisting keeps the payment visible even
    // though the worker cursor moves on; the row is safe to replay.
    logger.error({ txHash: payment.txHash, err: error.message }, "Payment reconciliation lookup failed");
    decision = {
      ...reject(REASONS.LOOKUP_FAILED, "Reconciliation lookup failed or timed out; replay the payment"),
      referenceKind: "none",
    };
  }

  let result;
  switch (decision.outcome) {
    case "rejected":
      await persistUnreconciled(payment, decision);
      return {
        outcome: "rejected",
        reasonCode: decision.reasonCode,
        transactionId: decision.transactionId,
      };
    case "duplicate":
      result = await handleDuplicate(decision.transaction);
      break;
    case "donate":
      result = await createConfirmedDonation(payment, decision.donorId);
      break;
    default:
      result = await confirmTransaction(decision.transaction, payment, decision.settledHash);
  }

  await markResolved(payment.txHash);
  return result;
};

export const getReconciliationStatus = async () => {
  const CursorModel = (await import("../../models/IngestionCursor.js")).default;
  const cursors = await CursorModel.find({}).lean();
  const unreconciledCount = await UnreconciledPayment.countDocuments({ resolvedAt: null });
  const byReason = await UnreconciledPayment.aggregate([
    { $match: { resolvedAt: null } },
    { $group: { _id: { $ifNull: ["$reasonCode", "unclassified"] }, count: { $sum: 1 } } },
  ]);
  const confirmedByWorker = await Transaction.countDocuments({
    status: "confirmed",
    reconciledAt: { $exists: true },
  });
  return {
    cursors,
    unreconciledCount,
    unreconciledByReason: Object.fromEntries(byReason.map(({ _id, count }) => [_id, count])),
    confirmedByWorker,
  };
};
