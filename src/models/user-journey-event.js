import mongoose from "mongoose";

const userJourneyEventSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    sessionId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      enum: [
        "page_visit",
        "action",
        "navigation",
        "search",
        "purchase",
        "enrollment",
        "content_view",
      ],
      index: true,
    },
    page: {
      type: String,
      required: true,
      trim: true,
    },
    action: {
      type: String,
      default: null,
      trim: true,
    },
    referrer: {
      type: String,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    userAgent: {
      type: String,
      default: null,
    },
    ipHash: {
      type: String,
      default: null,
      select: false,
    },
    duration: {
      type: Number,
      default: null,
      min: 0,
    },
  },
  {
    timestamps: true,
  }
);

userJourneyEventSchema.index({ sessionId: 1, createdAt: 1 });
userJourneyEventSchema.index({ userId: 1, createdAt: 1 });
userJourneyEventSchema.index({ page: 1, createdAt: -1 });
userJourneyEventSchema.index({ eventType: 1, createdAt: -1 });
userJourneyEventSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

export default mongoose.model("UserJourneyEvent", userJourneyEventSchema);
