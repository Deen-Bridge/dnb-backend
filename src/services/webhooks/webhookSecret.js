// services/webhooks/webhookSecret.js
//
// Webhook signing secrets are stored ENCRYPTED at rest (AES-256-GCM), not
// hashed — the delivery worker must recover the plaintext to compute the HMAC
// signature on every attempt, so a one-way hash is not an option. The secret
// is generated server-side, returned to the caller exactly once at creation
// (and once again on rotation), and never returned by any read endpoint.
//
// The encryption key is derived (SHA-256) from WEBHOOK_SECRET_ENCRYPTION_KEY.
// That variable is REQUIRED in production (validateEnv fails fast if missing);
// in development/test a fixed fallback key is used so the app boots without
// extra setup. Rotating WEBHOOK_SECRET_ENCRYPTION_KEY invalidates all stored
// secrets — rotate individual endpoint secrets via the API instead.
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard nonce length
const DEV_FALLBACK_KEY_MATERIAL = "dnb-webhook-dev-fallback-key-do-not-use-in-prod";

const deriveKey = () => {
  const material = process.env.WEBHOOK_SECRET_ENCRYPTION_KEY;
  if (!material) {
    if (process.env.NODE_ENV === "production") {
      // Should never happen — validateEnv fails fast — but never fall back to
      // a well-known key in production.
      throw new Error("WEBHOOK_SECRET_ENCRYPTION_KEY is required in production");
    }
    return crypto.createHash("sha256").update(DEV_FALLBACK_KEY_MATERIAL).digest();
  }
  return crypto.createHash("sha256").update(material).digest();
};

/** Generate a fresh, high-entropy webhook signing secret (hex). */
export const generateSecret = () => crypto.randomBytes(32).toString("hex");

/**
 * Encrypt a plaintext secret for storage. Returns `iv:authTag:ciphertext`,
 * all hex-encoded.
 */
export const encryptSecret = (plaintext) => {
  const key = deriveKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("hex"), authTag.toString("hex"), ciphertext.toString("hex")].join(":");
};

/** Decrypt a stored `iv:authTag:ciphertext` secret back to plaintext. */
export const decryptSecret = (stored) => {
  if (!stored || typeof stored !== "string") {
    throw new Error("No stored secret to decrypt");
  }
  const [ivHex, tagHex, ctHex] = stored.split(":");
  if (!ivHex || !tagHex || !ctHex) {
    throw new Error("Malformed stored webhook secret");
  }
  const key = deriveKey();
  const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ctHex, "hex")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
};
