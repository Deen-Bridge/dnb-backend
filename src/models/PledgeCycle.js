import mongoose from "mongoose";

const pledgeCycleSchema = new mongoose.Schema(
  {
    pledge: { type: mongoose.Schema.Types.ObjectId, ref: "Pledge", required: true, index: true },
    dueAt: { type: Date, required: true },
    status: { type: String, enum: ["due", "notified", "paid", "skipped", "lapsed"], default: "due", index: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: "Transaction", default: null },
    windowEndsAt: { type: Date, required: true, index: true },
    // Set by the retention sweep once a settled cycle (paid/skipped/lapsed)
    // ages past PLEDGE_CYCLE_RETENTION_DAYS. Archived cycles are kept for the
    // financial audit trail but hidden from the default history listing.
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

pledgeCycleSchema.index({ pledge: 1, dueAt: 1 }, { unique: true });
// Default cycle history (unarchived only), newest due date first.
pledgeCycleSchema.index({ pledge: 1, archivedAt: 1, dueAt: -1 });
// Retention sweep: settled, unarchived cycles older than the cutoff.
pledgeCycleSchema.index({ status: 1, archivedAt: 1, dueAt: 1 });
export default mongoose.model("PledgeCycle", pledgeCycleSchema);
