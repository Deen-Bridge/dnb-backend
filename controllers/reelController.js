import Reel from "../models/Reel.js";
//get all reels
export const getReels = async (_req, res) => {
  try {
    const reels = await Reel.find();
    res.status(200).json(reels);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
//create a reel
export const createReel = async (req, res) => {
  try {
      const { description, category, video } = req.body();
      
    const reel = new Reel({
      description,
      category,
      video,
      createdBy: req.user._id,
    });
      const saved = await reel.save();
    res.status(201).json({ message: "✅ Reel created", reel: saved });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
