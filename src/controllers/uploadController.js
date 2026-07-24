import cloudinary from "../utils/cloudinary.js";
import logger from "../config/logger.js";

export const generateSignature = async (req, res) => {
  try {
    const timestamp = Math.round(new Date().getTime() / 1000);
    const signature = cloudinary.utils.api_sign_request(
      {
        timestamp,
        folder: "direct-uploads",
      },
      process.env.CLOUDINARY_API_SECRET
    );

    res.status(200).json({
      success: true,
      timestamp,
      signature,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME,
      apiKey: process.env.CLOUDINARY_API_KEY,
    });
  } catch (error) {
    logger.error("Error generating Cloudinary signature:", error);
    res.status(500).json({ success: false, message: "Failed to generate upload signature" });
  }
};
