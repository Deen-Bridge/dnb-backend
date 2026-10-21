// models/CspViolation.js
//
// Aggregated Content-Security-Policy violation reports (issue #140).
// One document per (violatedDirective, blockedUri, documentOrigin) with a
// running counter, so a noisy browser cannot flood the collection.
// Documents expire 30 days after they were last seen.
import mongoose from "mongoose";

export const CSP_VIOLATION_TTL_SECONDS = 30 * 24 * 60 * 60;

const cspViolationSchema = new mongoose.Schema(
  {
    documentUri: { type: String, default: "" },
    documentOrigin: { type: String, default: "" },
    violatedDirective: { type: String, required: true },
    effectiveDirective: { type: String, default: "" },
    blockedUri: { type: String, default: "" },
    sourceFile: { type: String, default: "" },
    lineNumber: { type: Number, default: 0 },
    userAgent: { type: String, default: "" },
    ip: { type: String, default: "" },
    count: { type: Number, default: 1 },
    firstSeen: { type: Date, default: Date.now },
    lastSeen: { type: Date, default: Date.now },
  },
  { timestamps: false },
);

cspViolationSchema.index(
  { violatedDirective: 1, blockedUri: 1, documentOrigin: 1 },
  { unique: true },
);
cspViolationSchema.index(
  { lastSeen: 1 },
  { expireAfterSeconds: CSP_VIOLATION_TTL_SECONDS },
);

export default mongoose.models.CspViolation ||
  mongoose.model("CspViolation", cspViolationSchema);
