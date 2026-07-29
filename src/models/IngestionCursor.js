import mongoose from "mongoose";

const ingestionCursorSchema = new mongoose.Schema({
  account: {
    type: String,
    required: true,
    unique: true,
  },
  cursor: {
    type: String,
    default: "",
  },
  lastSyncAt: {
    type: Date,
  },
}, { timestamps: true });

export default mongoose.model("IngestionCursor", ingestionCursorSchema);
