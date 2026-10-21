// models/MultisigTransaction.js
import mongoose from "mongoose";

// Tracks a Stellar transaction that needs several signers. Only public keys,
// the unsigned transaction XDR and detached signatures are stored; secret
// keys are never accepted or persisted.
const signatureSchema = new mongoose.Schema(
  {
    publicKey: { type: String, required: true },
    signature: { type: String, required: true }, // base64 detached signature
    weight: { type: Number, required: true },
    signedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const multisigTransactionSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true, index: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    description: { type: String, maxlength: 280 },
    xdr: { type: String, required: true },
    txHash: { type: String, required: true, unique: true },
    threshold: { type: Number, required: true },
    // Snapshot of signer weights at creation: { publicKey: weight }
    signerWeights: { type: Map, of: Number, required: true },
    signatures: { type: [signatureSchema], default: [] },
    status: {
      type: String,
      enum: ["pending", "ready", "submitted", "failed"],
      default: "pending",
      index: true,
    },
    submittedHash: String,
    ledger: Number,
    error: String,
  },
  { timestamps: true }
);

export default mongoose.models.MultisigTransaction ||
  mongoose.model("MultisigTransaction", multisigTransactionSchema);
