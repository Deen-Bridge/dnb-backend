import User from "../models/User.js";
import logger from "../config/logger.js";

const SENSITIVE_FIELDS = new Set(["password", "refreshTokens", "resetPasswordToken", "emailVerificationToken"]);

/** Return a portable copy of the authenticated user's account data. */
export const exportMyData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();
    if (!user) return res.status(404).json({ success: false, message: "User not found" });
    const data = Object.fromEntries(Object.entries(user).filter(([key]) => !SENSITIVE_FIELDS.has(key)));
    return res.status(200).json({ success: true, exportedAt: new Date().toISOString(), data });
  } catch (error) {
    logger.error("GDPR export failed:", error);
    return res.status(500).json({ success: false, message: "Unable to export account data" });
  }
};
