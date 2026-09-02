import mongoose, { Schema } from "mongoose";

const notificationSchema = new Schema(
  {
    email: { type: Boolean, default: true },
    push: { type: Boolean, default: true },
    inApp: { type: Boolean, default: true },
    marketing: { type: Boolean, default: false },
    courseUpdates: { type: Boolean, default: true },
    prayerReminders: { type: Boolean, default: true },
    securityAlerts: { type: Boolean, default: true },
  },
  { _id: false }
);

const privacySchema = new Schema(
  {
    profileVisibility: {
      type: String,
      enum: ["public", "private", "followers"],
      default: "public",
    },
    showActivity: { type: Boolean, default: true },
    showLearningProgress: { type: Boolean, default: true },
    allowMessagesFrom: {
      type: String,
      enum: ["everyone", "followers", "none"],
      default: "everyone",
    },
    showInLeaderboards: { type: Boolean, default: true },
  },
  { _id: false }
);

const userPreferencesSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    theme: {
      type: String,
      enum: ["light", "dark", "system"],
      default: "light",
    },
    language: {
      type: String,
      default: "en",
      trim: true,
    },
    notifications: {
      type: notificationSchema,
      default: () => ({}),
    },
    privacy: {
      type: privacySchema,
      default: () => ({}),
    },
    timezone: {
      type: String,
      default: "UTC",
      trim: true,
    },
    fontSize: {
      type: String,
      enum: ["small", "medium", "large"],
      default: "medium",
    },
  },
  { timestamps: true }
);

userPreferencesSchema.statics.getOrCreateForUser = async function (userId) {
  let preferences = await this.findOne({ user: userId });
  if (!preferences) {
    preferences = await this.create({ user: userId });
  }
  return preferences;
};

export default mongoose.model("UserPreferences", userPreferencesSchema);
