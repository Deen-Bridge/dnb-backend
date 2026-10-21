import mongoose from "mongoose";

export const NOTIFICATION_EVENTS = ["sent", "delivered", "opened", "clicked"];
export const NOTIFICATION_CHANNELS = ["in_app", "email", "push"];

const notificationEventSchema = new mongoose.Schema(
  {
    notificationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Notification",
      required: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: { type: String, required: true },
    channel: { type: String, enum: NOTIFICATION_CHANNELS, default: "in_app" },
    event: { type: String, enum: NOTIFICATION_EVENTS, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

// Metrics queries filter by time window then group by type/channel/event.
notificationEventSchema.index({ timestamp: -1, type: 1, channel: 1, event: 1 });
// Per-notification lifecycle lookups.
notificationEventSchema.index({ notificationId: 1, event: 1 });

export default mongoose.model("NotificationEvent", notificationEventSchema);
