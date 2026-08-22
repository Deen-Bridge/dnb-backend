// controllers/stellar/giftController.js
//
// Gift-a-course/book flow built on Stellar claimable balances. The sender
// funds a claimable balance the recipient claims whenever they're ready
// (trustline-free), with a reclaim-after-expiry predicate. Access to the item
// is granted to the RECIPIENT on claim — never the payer. All signing is
// client-side; the server only builds unsigned XDR, records the real
// claimable-balance id, verifies on-chain, and grants access.
import User from "../../models/User.js";
import Book from "../../models/Book.js";
import Course from "../../models/Course.js";
import GiftClaim from "../../models/GiftClaim.js";
import {
  buildCreateClaimableBalanceTx,
  buildClaimTx,
  resolveBalanceId,
  getClaimableBalance,
  validateSignedGiftXdr,
  giftExpiryFromNow,
} from "../../services/stellar/claimableBalanceService.js";
import {
  submitTransaction,
  verifyTransaction,
  NETWORK,
  getExplorerUrl,
} from "../../services/stellar/stellarService.js";
import { grantItemAccess } from "../../services/stellar/reconciliationService.js";
import logger from "../../config/logger.js";

// Gift memos are tagged DNB-GIFT-<last 8 chars of the item id> so they are
// never mistaken for a purchase (DNB-(BOOK|COURSE)-...) or donation memo by
// the reconciliation worker.
const buildGiftMemo = (itemId) => `DNB-GIFT-${String(itemId).slice(-8)}`;

const isBeforeExpiry = (gift, now = Date.now()) =>
  now < gift.expiresAt.getTime();

/**
 * Initialize a gift: validate the recipient, build an unsigned
 * create_claimable_balance XDR, and persist a pending GiftClaim.
 * POST /api/stellar/gifts/initialize
 */
export const initializeGift = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { itemType, itemId, recipientUserId } = req.body;

    if (!["book", "course"].includes(itemType)) {
      return res.status(400).json({
        success: false,
        message: "Invalid item type. Must be 'book' or 'course'",
      });
    }

    const sender = await User.findById(senderId);
    if (!sender?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    const Model = itemType === "book" ? Book : Course;
    const populateField = itemType === "book" ? "author" : "createdBy";
    const item = await Model.findById(itemId).populate(
      populateField,
      "stellarWallet name"
    );
    if (!item) {
      return res.status(404).json({
        success: false,
        message: `${itemType} not found`,
      });
    }
    const creator = itemType === "book" ? item.author : item.createdBy;

    if (!item.price || item.price === 0) {
      return res.status(400).json({
        success: false,
        message: "This item is free, no gift needed",
      });
    }

    if (recipientUserId === senderId.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot gift an item to yourself",
      });
    }

    const recipient = await User.findById(recipientUserId);
    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: "Recipient not found",
      });
    }
    if (!recipient?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Recipient has not connected their Stellar wallet yet",
      });
    }

    // Already-owned guard, checked against the RECIPIENT (mirrors
    // initializePayment's guard in the purchase flow).
    const purchasedArray =
      itemType === "book" ? recipient.purchasedBooks : recipient.purchasedCourses;
    const idField = itemType === "book" ? "bookId" : "courseId";
    const alreadyOwns = purchasedArray?.some(
      (p) => p[idField]?.toString() === itemId
    );
    if (alreadyOwns) {
      return res.status(400).json({
        success: false,
        message: `Recipient already owns this ${itemType}`,
      });
    }

    // Duplicate-pending guard (mirrors initializePayment).
    const existingGift = await GiftClaim.findOne({
      sender: senderId,
      recipient: recipientUserId,
      itemType,
      itemId,
      status: { $in: ["pending_signature", "open"] },
    });
    if (existingGift) {
      return res.status(400).json({
        success: false,
        message: "You already have a pending gift for this recipient and item",
        giftId: existingGift._id,
      });
    }

    const expiresAt = giftExpiryFromNow();
    const paymentTx = await buildCreateClaimableBalanceTx({
      sourcePublicKey: sender.stellarWallet.publicKey,
      claimantPublicKey: recipient.stellarWallet.publicKey,
      amount: item.price.toString(),
      expiresAt,
      memo: buildGiftMemo(itemId),
    });

    const gift = new GiftClaim({
      sender: senderId,
      recipient: recipient._id,
      recipientWallet: recipient.stellarWallet.publicKey,
      creator: creator?._id,
      itemType,
      itemId,
      itemTypeModel: itemType === "book" ? "Book" : "Course",
      itemTitle: item.title,
      amount: item.price.toString(),
      assetCode: "USDC",
      status: "pending_signature",
      expiresAt,
      createTxHash: paymentTx.hash,
      network: NETWORK,
    });
    await gift.save();

    logger.info(
      `Gift initialized: ${gift._id} from ${senderId} to ${recipient._id} for ${itemType} ${itemId}`
    );

    res.status(200).json({
      success: true,
      giftId: gift._id,
      payment: {
        xdr: paymentTx.xdr,
        networkPassphrase: paymentTx.networkPassphrase,
        expectedHash: paymentTx.hash,
      },
      expiresAt: gift.expiresAt,
      item: {
        title: item.title,
        price: item.price,
        type: itemType,
      },
      recipient: {
        name: recipient.name,
        wallet: recipient.stellarWallet.publicKey,
      },
    });
  } catch (error) {
    logger.error("Initialize gift error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to initialize gift",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Submit the signed create_claimable_balance XDR, resolve the real balance
 * id, and mark the gift open.
 * POST /api/stellar/gifts/submit
 */
export const submitGift = async (req, res) => {
  try {
    const senderId = req.user._id;
    const { giftId, signedXdr } = req.body;

    if (!giftId || !signedXdr) {
      return res.status(400).json({
        success: false,
        message: "Gift ID and signed XDR are required",
      });
    }

    const gift = await GiftClaim.findOne({
      _id: giftId,
      sender: senderId,
      status: "pending_signature",
    });
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found or already processed",
      });
    }

    const sender = await User.findById(senderId);
    if (!sender?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    // Verify the signed XDR BEFORE any DB write or access grant — a tampered
    // XDR (wrong asset/amount/claimants) is rejected outright.
    try {
      validateSignedGiftXdr(signedXdr, {
        assetCode: gift.assetCode,
        amount: gift.amount,
        recipientWallet: gift.recipientWallet,
        senderWallet: sender.stellarWallet.publicKey,
        expiresAt: gift.expiresAt,
      });
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        message: "Signed transaction does not match expected gift details",
        error: validationError.message,
      });
    }

    let result;
    try {
      result = await submitTransaction(signedXdr);
    } catch (stellarError) {
      return res.status(400).json({
        success: false,
        message: "Transaction failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Resolve the REAL claimable-balance id — NOT the tx hash.
    const balanceId = await resolveBalanceId(result.hash, {
      amount: gift.amount,
      claimantPublicKey: gift.recipientWallet,
    });
    if (!balanceId) {
      // Leave the gift pending_signature so the client can retry — the
      // create tx is already on-chain, and a retry simply re-resolves the id.
      return res.status(502).json({
        success: false,
        message: "Could not resolve the claimable balance id yet; please retry",
        createTxHash: result.hash,
      });
    }

    gift.createTxHash = result.hash;
    gift.balanceId = balanceId;
    gift.status = "open";
    await gift.save();

    logger.info(
      `Gift submitted: ${gift._id}, balance ${balanceId} (tx ${result.hash})`
    );

    res.status(200).json({
      success: true,
      giftId: gift._id,
      balanceId,
      createTxHash: result.hash,
      explorerUrl: getExplorerUrl(result.hash),
    });
  } catch (error) {
    logger.error("Submit gift error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit gift",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * List gifts sent and received by the current user.
 * GET /api/stellar/gifts
 */
export const listGifts = async (req, res) => {
  try {
    const userId = req.user._id;

    // Lazy expiry transition: open gifts past their expiry flip to "expired"
    // (the document is never deleted — the sender still needs it to reclaim).
    await GiftClaim.updateMany(
      {
        $or: [{ sender: userId }, { recipient: userId }],
        status: "open",
        expiresAt: { $lte: new Date() },
      },
      { $set: { status: "expired" } }
    );

    const gifts = await GiftClaim.find({
      $or: [{ sender: userId }, { recipient: userId }],
    })
      .sort({ createdAt: -1 })
      .populate("sender", "name")
      .populate("recipient", "name");

    res.status(200).json({ success: true, gifts });
  } catch (error) {
    logger.error("List gifts error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gifts",
    });
  }
};

/**
 * Get a single gift with live Horizon status of the underlying balance.
 * GET /api/stellar/gifts/:id
 */
export const getGift = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const gift = await GiftClaim.findOne({
      _id: id,
      $or: [{ sender: userId }, { recipient: userId }],
    })
      .populate("sender", "name")
      .populate("recipient", "name");

    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    // Lazy expiry transition (see listGifts).
    if (gift.status === "open" && !isBeforeExpiry(gift)) {
      gift.status = "expired";
      await gift.save();
    }

    let live = null;
    if (gift.balanceId) {
      const balance = await getClaimableBalance(gift.balanceId);
      live = balance.exists
        ? {
            state: balance.record.state,
            sponsor: balance.record.sponsor,
            lastModifiedLedger: balance.record.last_modified_ledger,
          }
        : { state: "not_found" };
    }

    res.status(200).json({
      success: true,
      gift: { ...gift.toObject(), live },
    });
  } catch (error) {
    logger.error("Get gift error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch gift",
    });
  }
};

/**
 * Build an unsigned claim (or reclaim) XDR for a gift.
 * Recipient-only before expiry; sender-only after expiry (reclaim).
 * POST /api/stellar/gifts/:id/claim/initialize
 */
export const claimInitialize = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;

    const gift = await GiftClaim.findOne({
      _id: id,
      $or: [{ sender: userId }, { recipient: userId }],
    });
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    if (gift.status === "pending_signature") {
      return res.status(400).json({
        success: false,
        message: "Gift has not been submitted yet",
      });
    }
    if (gift.status === "claimed" || gift.status === "reclaimed") {
      return res.status(400).json({
        success: false,
        message: "Gift has already been claimed",
      });
    }

    const user = await User.findById(userId);
    if (!user?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    const isRecipient = gift.recipient.toString() === userId.toString();
    const isSender = gift.sender.toString() === userId.toString();
    if (!isRecipient && !isSender) {
      return res.status(403).json({
        success: false,
        message: "You are not a party to this gift",
      });
    }

    const beforeExpiry = isBeforeExpiry(gift);
    // Lazy expiry transition before the authorization decision.
    if (gift.status === "open" && !beforeExpiry) {
      gift.status = "expired";
      await gift.save();
    }

    if (beforeExpiry) {
      if (!isRecipient) {
        return res.status(403).json({
          success: false,
          message: "Only the recipient can claim this gift before it expires",
        });
      }
    } else if (!isSender) {
      return res.status(403).json({
        success: false,
        message: "This gift has expired; only the sender can reclaim it",
      });
    }

    const claim = await buildClaimTx({
      claimantPublicKey: user.stellarWallet.publicKey,
      balanceId: gift.balanceId,
    });

    res.status(200).json({
      success: true,
      giftId: gift._id,
      action: beforeExpiry ? "claim" : "reclaim",
      claim: {
        xdr: claim.xdr,
        networkPassphrase: claim.networkPassphrase,
        expectedHash: claim.hash,
        includesChangeTrust: claim.includesChangeTrust,
      },
    });
  } catch (error) {
    logger.error("Claim initialize error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to build claim transaction",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Submit a signed claim (or reclaim) XDR, verify it on-chain, and — for a
 * recipient claim — grant item access to the RECIPIENT.
 * POST /api/stellar/gifts/:id/claim/submit
 */
export const claimSubmit = async (req, res) => {
  try {
    const userId = req.user._id;
    const { id } = req.params;
    const { signedXdr } = req.body;

    if (!signedXdr) {
      return res.status(400).json({
        success: false,
        message: "Signed XDR is required",
      });
    }

    const gift = await GiftClaim.findOne({
      _id: id,
      $or: [{ sender: userId }, { recipient: userId }],
    });
    if (!gift) {
      return res.status(404).json({
        success: false,
        message: "Gift not found",
      });
    }

    if (gift.status === "pending_signature") {
      return res.status(400).json({
        success: false,
        message: "Gift has not been submitted yet",
      });
    }
    if (gift.status === "claimed" || gift.status === "reclaimed") {
      return res.status(400).json({
        success: false,
        message: "Gift has already been claimed",
      });
    }

    const user = await User.findById(userId);
    if (!user?.stellarWallet?.publicKey) {
      return res.status(400).json({
        success: false,
        message: "Please connect your Stellar wallet first",
      });
    }

    const isRecipient = gift.recipient.toString() === userId.toString();
    const isSender = gift.sender.toString() === userId.toString();
    if (!isRecipient && !isSender) {
      return res.status(403).json({
        success: false,
        message: "You are not a party to this gift",
      });
    }

    const beforeExpiry = isBeforeExpiry(gift);
    if (gift.status === "open" && !beforeExpiry) {
      gift.status = "expired";
      await gift.save();
    }

    if (beforeExpiry && !isRecipient) {
      return res.status(403).json({
        success: false,
        message: "Only the recipient can claim this gift before it expires",
      });
    }
    if (!beforeExpiry && !isSender) {
      return res.status(403).json({
        success: false,
        message: "This gift has expired; only the sender can reclaim it",
      });
    }

    let result;
    try {
      result = await submitTransaction(signedXdr);
    } catch (stellarError) {
      return res.status(400).json({
        success: false,
        message: "Transaction failed on Stellar network",
        error: stellarError.message,
      });
    }

    // Verify on-chain that the claim_claimable_balance op actually succeeded.
    const verification = await verifyTransaction(result.hash);
    if (!verification.exists || !verification.successful) {
      return res.status(400).json({
        success: false,
        message: "Claim transaction did not succeed on the Stellar network",
      });
    }
    const claimOp = (verification.operations || []).find(
      (op) => op.type === "claim_claimable_balance"
    );
    if (!claimOp) {
      return res.status(400).json({
        success: false,
        message:
          "Claim transaction did not contain a claim_claimable_balance operation",
      });
    }

    if (beforeExpiry) {
      // Recipient claim → grant access to the RECIPIENT, never the sender.
      // This deliberately inverts the buyer-centric purchase flow: the payer
      // (sender) funded the balance, but the beneficiary (recipient) is the
      // one who gains course/book access.
      await grantItemAccess({
        buyerId: gift.recipient,
        itemType: gift.itemType,
        itemId: gift.itemId,
      });
      gift.status = "claimed";
    } else {
      gift.status = "reclaimed";
    }
    gift.claimTxHash = result.hash;
    await gift.save();

    logger.info(
      `Gift ${gift._id} ${beforeExpiry ? "claimed" : "reclaimed"} by ${userId} (tx ${result.hash})`
    );

    res.status(200).json({
      success: true,
      giftId: gift._id,
      action: beforeExpiry ? "claimed" : "reclaimed",
      claimTxHash: result.hash,
      explorerUrl: getExplorerUrl(result.hash),
    });
  } catch (error) {
    logger.error("Claim submit error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to submit claim",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
