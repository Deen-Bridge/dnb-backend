// models/GiftClaim.js
//
// A gift of a course/book paid via a Stellar claimable balance. The sender
// creates an on-ledger balance the recipient can claim whenever they're ready
// (trustline-free), with a reclaim-after-expiry predicate so funds are never
// stranded. Access to the item is granted to the RECIPIENT on claim, never the
// sender.
//
// NOTE: unlike Transaction.expiresAt, this schema deliberately has NO TTL
// index. A gift record must survive past its expiry so the sender can still
// fetch a reclaim XDR afterward — the expiry transition only flips `status`
// to "expired" and never deletes the document.
import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";

const giftClaimSchema = new mongoose.Schema(
  {
    // Who funded the balance (the payer).
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // Who receives the item (the beneficiary). Deliberately distinct from the
    // sender — access is granted to this user on claim.
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    recipientWallet: {
      type: String,
      required: true,
    },
    // The item's creator (for display only — the creator is not paid through
    // the claimable-balance path; that stays out of scope).
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    itemType: {
      type: String,
      enum: ["book", "course"],
      required: true,
    },
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      refPath: "itemTypeModel",
    },
    itemTypeModel: {
      type: String,
      enum: ["Book", "Course"],
      required: true,
    },
    itemTitle: {
      type: String,
      required: true,
    },
    // Amount stored as string to preserve precision (USDC only).
    amount: {
      type: String,
      required: true,
    },
    assetCode: {
      type: String,
      default: "USDC",
      enum: getSupportedCodes(),
    },
    // The REAL claimable-balance id (hex-encoded XDR of ClaimableBalanceId),
    // resolved from the create transaction's result — NOT the tx hash.
    // Unique + sparse because it is only known after the create tx lands.
    balanceId: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["pending_signature", "open", "claimed", "reclaimed", "expired"],
      default: "pending_signature",
      index: true,
    },
    // Predicate expiry for the balance. Sender reclaims after this instant.
    // No TTL index — see comment at top of file.
    expiresAt: {
      type: Date,
      required: true,
    },
    createTxHash: {
      type: String,
    },
    claimTxHash: {
      type: String,
    },
    network: {
      type: String,
      enum: ["testnet", "mainnet"],
      required: true,
    },
  },
  { timestamps: true }
);

giftClaimSchema.index({ sender: 1, status: 1 });
giftClaimSchema.index({ recipient: 1, status: 1 });
giftClaimSchema.index({ recipient: 1, itemType: 1, itemId: 1 });

export default mongoose.model("GiftClaim", giftClaimSchema);
