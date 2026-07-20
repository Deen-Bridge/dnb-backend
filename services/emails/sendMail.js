import axios from "axios";
import logger from "../../src/config/logger.js";

const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID || "service_5cyu19r";
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID || "template_ph4f0rl";
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY || "xsR_t0uapauk8d_6Tk0Y9";
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY || "p_hFoYPb6o0w7206-";
const EMAILJS_API_URL = process.env.EMAILJS_API_URL || "https://api.emailjs.com/api/v1.0/email/send";

const sendMail = async (otp, email) => {
  if (!email || !otp) {
    throw new Error("Email and OTP are required to send the email.");
  }
  logger.info(`Sending OTP email to: ${email}`);
  try {
    const response = await axios.post(EMAILJS_API_URL, {
      service_id: EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id: EMAILJS_PUBLIC_KEY,
      template_params: {
        "otp": otp,
        "email": email,
      },
    });
    return { status: response.status, text: response.statusText };
  } catch (error) {
    logger.error("Error sending otp email:", error.response?.data || error.message);
    throw error;
  }
};

export default sendMail;
