// models/Hashtag.js — Issue #212
import mongoose from "mongoose";

const { Schema } = mongoose;

/**
 * Hashtag document tracks cumulative usage and a derived trending score.
 * The score is recalculated by the trending-hashtags job every hour.
 */
const hashtagSchema = new Schema(
  {
    /** Normalised tag text, e.g. "islamicquotes" (lowercase, no #). */
    tag: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      maxlength: 100,
    },
    /** Total number of reels that reference this tag. */
    usageCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    /**
     * Trending score — higher = trending more strongly.
     * Computed by the hourly job as a recency-weighted usage count.
     */
    trendingScore: {
      type: Number,
      default: 0,
    },
    /** When the score was last recalculated. */
    lastCalculatedAt: {
      type: Date,
    },
    /** Reels created with this tag in the last 24 h (updated by the job). */
    recentUsage24h: {
      type: Number,
      default: 0,
    },
    /** Reels created with this tag in the last 7 days. */
    recentUsage7d: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

// Fast lookup by trending score for the "Trending" section.
hashtagSchema.index({ trendingScore: -1 });
// Fast lookup by tag name (already unique, but explicit for clarity).
hashtagSchema.index({ tag: 1 });

const Hashtag = mongoose.model("Hashtag", hashtagSchema);

export default Hashtag;
