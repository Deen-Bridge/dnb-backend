import express from "express";
import logger from "../config/logger.js";
import { sendOtpEmail } from "../../services/emails/sendMail.js";
import { generateOtp } from "../utils/otp.js";
const router = express.Router();

router.post("/", async (req, res) => {
  const { email } = req.body;
  logger.info(`Received email: ${email}`);
  // Validate email
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Invalid email format" });
  }
  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    const otp = generateOtp();
    await sendOtpEmail(otp, email);

    res.json({ success: true, message: "OTP sent" });
  } catch (error) {
    logger.error("Failed to send OTP:", error);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

export default router;
