import mongoose from "mongoose";
import crypto from "crypto";

const webhookEndpointSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: [true, "Endpoint URL is required"],
      validate: {
        validator: function (v) {
          if (process.env.NODE_ENV === "production") {
            return /^https:\/\//.test(v);
          }
          return /^https?:\/\//.test(v);
        },
        message: "Endpoint URL must use HTTPS in production",
      },
    },
    secret: {
      type: String,
      required: true,
      select: false,
    },
    description: {
      type: String,
      maxlength: 200,
      default: "",
    },
    events: {
      type: [String],
      required: [true, "At least one event type is required"],
      validate: {
        validator: function (v) {
          return v.length > 0;
        },
        message: "At least one event type is required",
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    consecutiveFailures: {
      type: Number,
      default: 0,
    },
    totalDeliveries: {
      type: Number,
      default: 0,
    },
    totalFailures: {
      type: Number,
      default: 0,
    },
    disabledAt: {
      type: Date,
    },
    disabledReason: {
      type: String,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { timestamps: true }
);

webhookEndpointSchema.index({ owner: 1 });
webhookEndpointSchema.index({ isActive: 1 });

/**
 * Generate a random webhook secret.
 * Returns the raw secret (shown once) and the hashed version (stored).
 */
webhookEndpointSchema.statics.generateSecret = function () {
  const raw = `whsec_${crypto.randomBytes(32).toString("hex")}`;
  const hashed = crypto.createHash("sha256").update(raw).digest("hex");
  return { raw, hashed };
};

/**
 * Verify a raw secret against the stored hash.
 */
webhookEndpointSchema.statics.verifySecret = function (raw, hashed) {
  const computed = crypto.createHash("sha256").update(raw).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hashed));
};

/**
 * Check if this endpoint is subscribed to the given event type.
 * Wildcard "*" matches all events.
 */
webhookEndpointSchema.methods.isSubscribedTo = function (eventType) {
  return this.events.includes("*") || this.events.includes(eventType);
};

export default mongoose.model("WebhookEndpoint", webhookEndpointSchema);
