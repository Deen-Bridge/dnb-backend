import mongoose from "mongoose";

const pledgeCycleSchema = new mongoose.Schema(
  {
    pledge: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Pledge",
      required: true,
      index: true,
    },
    dueAt: {
      type: Date,
      required: true,
      index: true,
    },
    windowEndsAt: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["due", "notified", "paid", "skipped", "lapsed"],
      default: "due",
      index: true,
    },
    transaction: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Transaction",
    },
  },
  { timestamps: true }
);

export default mongoose.model("PledgeCycle", pledgeCycleSchema);
