import cloudinary from "../utils/cloudinary.js";
import logger from "../config/logger.js";

export const generateSignature = async (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const config = cloudinary.config();
    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        folder: "direct-uploads",
      },
      config.api_secret
    );

    res.status(200).json({
      success: true,
      message: "Signature generated successfully",
      data: {
        timestamp,
        signature,
        cloudName: config.cloud_name,
        apiKey: config.api_key,
      }
    });
  } catch (error) {
    logger.error("Error generating Cloudinary signature:", error);
    res.status(500).json({ success: false, message: "Failed to generate upload signature", data: null });
  }
};
