// utils/twoFactorCrypto.js
import crypto from "crypto";
import bcrypt from "bcrypt";

const ALGORITHM = "aes-256-gcm";
const KEY_STRING =
  process.env.TWO_FACTOR_ENCRYPTION_KEY ||
  process.env.JWT_SECRET ||
  "deenbridge-default-2fa-encryption-secret-key-32-chars!";

// Derive a 32-byte key from key string
const getKey = () => crypto.createHash("sha256").update(KEY_STRING).digest();

/**
 * Encrypt a plain secret string (AES-256-GCM)
 * Format: ivHex:tagHex:encryptedHex
 */
export const encryptSecret = (text) => {
  if (!text) return text;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${tag}:${encrypted}`;
};

/**
 * Decrypt an encrypted secret string (AES-256-GCM)
 */
export const decryptSecret = (encryptedText) => {
  if (!encryptedText) return encryptedText;
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    // If not in iv:tag:ciphertext format (e.g. legacy/testing), return as-is
    return encryptedText;
  }
  const [ivHex, tagHex, encryptedDataHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encryptedDataHex, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
};

/**
 * Generate N single-use recovery codes.
 * Returns { plainCodes, hashedCodes }
 */
export const generateRecoveryCodes = async (count = 10) => {
  const plainCodes = [];
  const hashedCodes = [];
  for (let i = 0; i < count; i++) {
    const raw = crypto.randomBytes(6).toString("hex").toUpperCase();
    const formatted = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    plainCodes.push(formatted);
    const hashed = await bcrypt.hash(formatted, 10);
    hashedCodes.push(hashed);
  }
  return { plainCodes, hashedCodes };
};

/**
 * Check input code against user's hashed recovery codes.
 * If a match is found, remove the code (single-use) and return true.
 */
export const verifyAndConsumeRecoveryCode = async (user, inputCode) => {
  if (
    !user.twoFactor ||
    !Array.isArray(user.twoFactor.recoveryCodes) ||
    user.twoFactor.recoveryCodes.length === 0
  ) {
    return false;
  }

  const formattedInput = inputCode.trim().toUpperCase();

  for (let i = 0; i < user.twoFactor.recoveryCodes.length; i++) {
    const hashed = user.twoFactor.recoveryCodes[i];
    const isMatch = await bcrypt.compare(formattedInput, hashed);
    if (isMatch) {
      user.twoFactor.recoveryCodes.splice(i, 1);
      return true;
    }
  }

  return false;
};

/**
 * Base32 decoding helper for TOTP secrets
 */
const base32Decode = (base32) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = base32.replace(/=+$/, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

/**
 * Generate a random Base32 TOTP secret string (20 chars)
 */
export const generateBase32Secret = (length = 20) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const randomBytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += alphabet[randomBytes[i] % 32];
  }
  return secret;
};

/**
 * Generate a 6-digit TOTP code (RFC 6238) for a given time step (default: current 30s window)
 */
export const generateTOTPCode = (secret, timeStep = Math.floor(Date.now() / 1000 / 30)) => {
  const key = base32Decode(secret);
  const buf = Buffer.alloc(8);
  buf.writeBigInt64BE(BigInt(timeStep));
  const hmac = crypto.createHmac("sha1", key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codeInt =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (codeInt % 1000000).toString().padStart(6, "0");
};

/**
 * Verify a 6-digit TOTP token against a Base32 secret with +-window steps (default 1 = +-30s)
 */
export const verifyTOTPCode = (token, secret, window = 1) => {
  if (!token || !secret) return false;
  const cleanToken = token.toString().trim();
  const currentStep = Math.floor(Date.now() / 1000 / 30);
  for (let i = -window; i <= window; i++) {
    const expected = generateTOTPCode(secret, currentStep + i);
    if (cleanToken === expected) {
      return true;
    }
  }
  return false;
};

/**
 * Build standard otpauth:// URI
 */
export const generateOtpauthUrl = (email, secret, issuer = "DeenBridge") => {
  const label = `${issuer}:${email}`;
  return `otpauth://totp/${encodeURIComponent(label)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
};

