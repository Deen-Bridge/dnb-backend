// models/WebhookDelivery.js
//
// One row per (event, subscribed endpoint). ALL scheduling state lives in the
// document (status, attemptCount, nextAttemptAt) rather than in worker memory,
// so the delivery loop can later be swapped onto the durable job queue (issue
// #32) without a schema change. `nextAttemptAt` is indexed for the claim query.
import mongoose from "mongoose";

// Bound the stored attempt history and per-attempt error text so a flapping
// consumer can't grow a document unbounded.
export const MAX_STORED_ATTEMPTS = 20;
export const MAX_ERROR_LENGTH = 500;

const attemptSchema = new mongoose.Schema(
  {
    at: { type: Date, default: Date.now },
    statusCode: Number,
    error: String,
    durationMs: Number,
  },
  { _id: false }
);

const webhookDeliverySchema = new mongoose.Schema(
  {
    endpoint: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebhookEndpoint",
      required: true,
      index: true,
    },
    // Stable per-event id used by consumers for idempotency. Shared across the
    // fan-out of one event to multiple endpoints.
    eventId: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
    },
    // Frozen event envelope ({ eventId, type, createdAt, apiVersion, data }).
    // Serialized ONCE at delivery time so the signed bytes match the sent body.
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
      enum: ["pending", "retrying", "delivered", "dead"],
      default: "pending",
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    // When the delivery becomes eligible for its next attempt. Indexed and
    // used by the atomic claim query.
    nextAttemptAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    deliveredAt: Date,
    lastError: String,
  },
  { timestamps: true }
);

// Compound index backing the worker's claim query.
webhookDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

export default mongoose.model("WebhookDelivery", webhookDeliverySchema);
