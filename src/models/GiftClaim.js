import mongoose from "mongoose";

const giftClaimSchema = new mongoose.Schema(
  {
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    recipientWallet: {
      type: String,
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
    itemTitle: {
      type: String,
      required: true,
    },
    amount: {
      type: String,
      required: true,
    },
    balanceId: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ["pending_signature", "open", "claimed", "reclaimed", "expired"],
      required: true,
    },
    claimExpiryDate: {
      type: Date,
      required: true,
    },
    creationTxHash: {
      type: String,
    },
    claimTxHash: {
      type: String,
    },
    network: {
      type: String,
      required: true,
      enum: ["testnet", "mainnet"],
    },
  },
  { timestamps: true }
);

// We need a virtual to help refPath work since we use "book"/"course" in itemType
giftClaimSchema.virtual("itemTypeModel").get(function () {
  return this.itemType === "book" ? "Book" : "Course";
});

// Indexes for list endpoints
giftClaimSchema.index({ recipient: 1, status: 1 });
giftClaimSchema.index({ sender: 1, status: 1 });

export default mongoose.model("GiftClaim", giftClaimSchema);
