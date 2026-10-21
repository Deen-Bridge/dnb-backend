import crypto from "crypto";

export const generateReferralCode = (length: number = 8): string => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // Exclude confusing characters like O, 0, I, 1
  let code = "";
  const randomBytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    const randomIndex = randomBytes[i] % chars.length;
    code += chars[randomIndex];
  }
  return code;
};
