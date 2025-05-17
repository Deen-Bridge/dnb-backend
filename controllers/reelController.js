import Reel from "../models/Reel.js";
import cloudinary from "../utils/cloudinary.js";


//get all reels
export const getReels = async (_req, res) => {
  try {
    const reels = await Reel.find();
    res.status(200).json(reels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};





// 🎬 Create a Reel
export const createReel = async (req, res) => {
  try {
    const { description, category } = req.body;
    const userId = req.user?._id; // from protect middleware

    if (!req.file) {
      return res
        .status(400)
        .json({ success: false, message: "Video file is required" });
    }

    // Upload video to Cloudinary
    const uploadedVideo = await cloudinary.uploader.upload(req.file.path, {
      resource_type: "video",
      folder: "dnb/reels",
    });

    // Create reel in DB
    const reel = await Reel.create({
      description,
      category,
      video: uploadedVideo.secure_url,
      createdBy: userId,
    });

    res.status(201).json({ success: true, reel });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
