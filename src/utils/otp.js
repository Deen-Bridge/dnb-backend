import crypto from "crypto";
import bcrypt from "bcryptjs";

/**
 * Generate a cryptographically secure 6-digit numeric OTP.
 * @returns {string} 6-digit OTP string
 */
export const generateOtp = () => {
  return crypto.randomInt(100000, 1000000).toString();
};

/**
 * Hash an OTP using bcrypt.
 * @param {string} otp
 * @returns {Promise<string>} Hashed OTP string
 */
export const hashOtp = async (otp) => {
  return await bcrypt.hash(otp, 12);
};

/**
 * Verify a plaintext OTP against a hashed OTP using bcrypt.
 * @param {string} otp
 * @param {string} hashedOtp
 * @returns {Promise<boolean>} True if valid, false otherwise
 */
export const verifyOtp = async (otp, hashedOtp) => {
  if (!otp || !hashedOtp) return false;
  return await bcrypt.compare(otp, hashedOtp);
};
