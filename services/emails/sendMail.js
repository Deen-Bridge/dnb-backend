import axios from "axios";
import logger from "../../src/config/logger.js";

const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_RECEIPT_TEMPLATE_ID = process.env.EMAILJS_RECEIPT_TEMPLATE_ID || EMAILJS_TEMPLATE_ID;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_API_URL = process.env.EMAILJS_API_URL || "https://api.emailjs.com/api/v1.0/email/send";

const sendTemplate = async (templateId, email, templateParams) => {
  if (
    process.env.NODE_ENV !== "test" &&
    (!EMAILJS_SERVICE_ID || !templateId || !EMAILJS_PUBLIC_KEY)
  ) {
    throw new Error("EmailJS environment variables are not configured");
  }
  try {
    const response = await axios.post(EMAILJS_API_URL, {
      service_id: EMAILJS_SERVICE_ID,
      template_id: templateId,
      user_id: EMAILJS_PUBLIC_KEY,
      accessToken: EMAILJS_PRIVATE_KEY,
      template_params: { ...templateParams, email },
    });
    return { status: response.status, text: response.statusText };
  } catch (error) {
    logger.error("Error sending otp email:", error.response?.data || error.message);
    throw error;
  }
};

export const sendOtpEmail = async (otp, email) => {
  if (!email || !otp) throw new Error("Email and OTP are required to send the email.");
  logger.info(`Sending OTP email to: ${email}`);
  return sendTemplate(EMAILJS_TEMPLATE_ID, email, { otp });
};

export const sendReceiptEmail = async (receipt) => {
  if (!receipt.email || !receipt.txHash) throw new Error("Receipt email and transaction hash are required");
  logger.info(`Sending receipt for ${receipt.txHash} to: ${receipt.email}`);
  return sendTemplate(EMAILJS_RECEIPT_TEMPLATE_ID, receipt.email, receipt);
};

const sendMail = sendOtpEmail;

export default sendMail;
