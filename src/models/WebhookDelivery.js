import mongoose from "mongoose";

const MAX_ATTEMPT_BODY_BYTES = 4096;

const attemptSchema = new mongoose.Schema(
  {
    at: { type: Date, required: true },
    statusCode: { type: Number },
    error: { type: String, maxlength: 512 },
    durationMs: { type: Number },
    responseBody: { type: String, maxlength: MAX_ATTEMPT_BODY_BYTES },
  },
  { _id: false }
);

const webhookDeliverySchema = new mongoose.Schema(
  {
    endpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebhookEndpoint",
      required: true,
    },
    eventId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    attempts: {
      type: [attemptSchema],
      default: [],
    },
    status: {
      type: String,
      enum: ["pending", "delivered", "retrying", "dead", "processing"],
      default: "pending",
      index: true,
    },
    nextAttemptAt: {
      type: Date,
      default: () => new Date(),
      index: true,
    },
    lastAttemptAt: {
      type: Date,
    },
    deliveredAt: {
      type: Date,
    },
  },
  { timestamps: true }
);

webhookDeliverySchema.index({ endpoint: 1, status: 1 });
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model("WebhookDelivery", webhookDeliverySchema);
