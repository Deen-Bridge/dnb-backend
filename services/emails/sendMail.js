import axios from "axios";

const EMAILJS_SERVICE_ID = process.env.EMAILJS_SERVICE_ID;
const EMAILJS_TEMPLATE_ID = process.env.EMAILJS_TEMPLATE_ID;
const EMAILJS_PRIVATE_KEY = process.env.EMAILJS_PRIVATE_KEY;
const EMAILJS_PUBLIC_KEY = process.env.EMAILJS_PUBLIC_KEY;
const EMAILJS_API_URL = process.env.EMAILJS_API_URL;

const sendMail = async (otp, email) => {
  if (!email || !otp) {
    throw new Error("Email and OTP are required to send the email.");
  }
console.log("Sending OTP email to:", email, "with OTP:", otp);
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
    console.error(
      "Error sending otp email:",
      error.response?.data || error.message
    );
    throw error;
  }
};

export default sendMail;
