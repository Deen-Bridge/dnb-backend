import mongoose from "mongoose";

const reelCommentSchema = new mongoose.Schema(
  {
    reel: { type: mongoose.Schema.Types.ObjectId, ref: "Reel", required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    status: { type: String, enum: ["active", "removed"], default: "active" },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Paginated reads use this index; removed rows remain auditable and are not
// returned to clients.
reelCommentSchema.index({ reel: 1, status: 1, createdAt: -1 });
reelCommentSchema.index({ reel: 1, user: 1, createdAt: -1 });

export default mongoose.model("ReelComment", reelCommentSchema);
