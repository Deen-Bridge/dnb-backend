import express from "express";
import sendMail from "../../services/emails/sendMail.js";
const router = express.Router();
export const generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();

router.post("/", async (req, res) => {
  const { email } = req.body;
  console.log("Received email:", email);
  // Validate email
  if (!email || typeof email !== "string") {
    return res.status(400).json({ message: "Invalid email format" });
  }
  if (!email) return res.status(400).json({ message: "Email is required" });

  try {
    await sendMail(generatedOtp, email);

    res.json({ success: true, otp: generatedOtp, message: "OTP sent" });
  } catch (error) {
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

export default router;
