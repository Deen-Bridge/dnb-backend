// models/WebhookEndpoint.js
//
// A registered outbound webhook subscription. The signing `secret` is stored
// ENCRYPTED at rest (AES-256-GCM via services/webhooks/webhookSecret.js) — the
// delivery worker must recover the plaintext to sign each request, so a
// one-way hash cannot be used. The encrypted field is `select:false` so it is
// never returned by an accidental find(); read endpoints strip it explicitly.
import mongoose from "mongoose";

const webhookEndpointSchema = new mongoose.Schema(
  {
    // Destination URL. Validated (https-only outside development, no private
    // targets) by services/webhooks/urlGuard.js at registration and delivery.
    url: {
      type: String,
      required: true,
      trim: true,
    },
    // AES-256-GCM ciphertext (`iv:authTag:ciphertext`, hex). Never selected by
    // default; never returned by the API after creation/rotation.
    secretEncrypted: {
      type: String,
      required: true,
      select: false,
    },
    // Subscribed event types. `["*"]` subscribes to everything.
    events: {
      type: [String],
      default: ["*"],
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    // Count of CONSECUTIVE dead deliveries. Reset to 0 on any successful
    // delivery. When it reaches the auto-disable threshold the endpoint is
    // deactivated by the delivery worker.
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    lastDeliveryAt: Date,
    lastSuccessAt: Date,
    disabledAt: Date,
    disabledReason: String,
    // The admin who registered the endpoint.
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
  },
  { timestamps: true }
);

webhookEndpointSchema.index({ owner: 1, createdAt: -1 });

// Defense in depth: never leak the encrypted secret through toJSON/toObject,
// even if a caller forgot to `.select("-secretEncrypted")`.
const stripSecret = (_doc, ret) => {
  delete ret.secretEncrypted;
  return ret;
};
webhookEndpointSchema.set("toJSON", { transform: stripSecret });
webhookEndpointSchema.set("toObject", { transform: stripSecret });

export default mongoose.model("WebhookEndpoint", webhookEndpointSchema);
