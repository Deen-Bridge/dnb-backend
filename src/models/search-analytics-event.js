import mongoose from "mongoose";

const searchAnalyticsEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      default: null,
      index: true,
    },
    query: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    type: {
      type: String,
      default: "all",
      enum: ["all", "courses", "books", "spaces", "reels", "educators"],
    },
    resultCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    hasResults: {
      type: Boolean,
      default: true,
      index: true,
    },
    filters: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    userAgent: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// Lookup by query popularity within a window.
searchAnalyticsEventSchema.index({ query: 1, createdAt: -1 });
// Efficient zero-result reporting.
searchAnalyticsEventSchema.index({ hasResults: 1, createdAt: -1 });
// Rolling 90-day retention; older events are auto-pruned.
searchAnalyticsEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 }
);

export default mongoose.model(
  "SearchAnalyticsEvent",
  searchAnalyticsEventSchema
);