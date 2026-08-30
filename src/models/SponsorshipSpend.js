// models/SponsorshipSpend.js
//
// Durable spend accounting for fee-bump sponsorship (#30). One document per
// UTC day tracks how much XLM (in stroops) the platform sponsor account has
// spent on network fees and how many sponsored transactions each user has
// been granted, so the per-day total cap and per-user daily count cap can be
// enforced across process restarts and horizontal replicas.
import mongoose from "mongoose";

const sponsorshipSpendSchema = new mongoose.Schema(
  {
    // UTC calendar day, formatted YYYY-MM-DD. Unique so `$inc` upserts race
    // safely on a single row per day.
    day: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    // Total XLM fees paid by the sponsor account today, in stroops. Daily caps
    // are small (well under Number.MAX_SAFE_INTEGER), so a Number here keeps
    // atomic `$inc` accounting simple without BigInt gymnastics.
    totalStroops: {
      type: Number,
      default: 0,
    },
    // Count of transactions sponsored today (across all users).
    sponsoredCount: {
      type: Number,
      default: 0,
    },
    // Per-user sponsored-transaction counts for today, keyed by user id string.
    // Enforces FEE_SPONSOR_PER_USER_DAILY_LIMIT.
    userCounts: {
      type: Map,
      of: Number,
      default: () => new Map(),
    },
  },
  { timestamps: true }
);

export default mongoose.model("SponsorshipSpend", sponsorshipSpendSchema);
