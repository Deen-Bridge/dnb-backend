import mongoose from "mongoose";
import { INGESTION_ERROR_CODES } from "../services/stellar/ingestionConfig.js";

export { INGESTION_ERROR_CODES };

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
  // Kept for compatibility with rows written before #696; mirrors
  // lastSuccessAt on every successful poll.
  lastSyncAt: {
    type: Date,
  },
  // Health state (#696). Everything below is written by the ingestion worker
  // and read only through reconciliationHealthService, which maps it to a
  // stable DTO — never return these documents from the API directly.
  lastPollAt: {
    type: Date,
  },
  lastSuccessAt: {
    type: Date,
  },
  consecutiveFailures: {
    type: Number,
    default: 0,
    min: 0,
  },
  lastErrorAt: {
    type: Date,
  },
  lastErrorCode: {
    type: String,
    enum: Object.values(INGESTION_ERROR_CODES),
  },
  // Advisory liveness lease, renewed on every poll. It does not provide
  // mutual exclusion (settlement is already compare-and-set); it only lets
  // the status endpoint tell a polling worker from one that has gone away.
  workerId: {
    type: String,
  },
  leaseExpiresAt: {
    type: Date,
  },
}, { timestamps: true });

export default mongoose.model("IngestionCursor", ingestionCursorSchema);
