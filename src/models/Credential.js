import mongoose from "mongoose";

const credentialSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    credentialId: { type: String, required: true, unique: true, index: true },
    publicKey: { type: String, required: true },
    counter: { type: Number, default: 0 },
    transports: { type: [String], default: [] },
  },
  { timestamps: true },
);

export default mongoose.models.Credential || mongoose.model("Credential", credentialSchema);
