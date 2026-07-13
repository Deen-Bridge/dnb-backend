import Space from "../models/Space.js";
import cloudinary from "../utils/cloudinary.js";

// 📚 Get all spaces
export const getSpaces = async (_req, res) => {
  try {
    const spaces = await Space.find().populate("host", "name email avatar");
    res.status(200).json({ success: true, spaces });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getSpaceById = async (req, res) => {
  try {
    const space = await Space.findById(req.params.id).populate(
      "host",
      "name email avatar"
    );
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ➕ Create a new space
export const createSpace = async (req, res) => {
  try {
    const { title, description, category, price, status, eventDate, duration } =
      req.body;
    const user = req.user; // from auth middleware

    // Handle thumbnail upload
    let thumbnailUrl = "";
    if (req.files && req.files.thumbnail && req.files.thumbnail[0]) {
      const thumbnailUpload = await new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          { folder: "spaces/thumbnails" },
          (error, result) => {
            if (error) reject(error);
            else resolve(result);
          }
        );
        stream.end(req.files.thumbnail[0].buffer);
      });
      thumbnailUrl = thumbnailUpload.secure_url;
    }

    const space = await Space.create({
      title,
      description,
      category,
      thumbnail: thumbnailUrl,
      price: price || 0,
      status: "upcoming",
      eventDate,
      duration,
      host: user._id,
    });
    res.status(201).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📝 Update a space
export const updateSpace = async (req, res) => {
  try {
    const { id } = req.params;
    // Only allow these fields to be updated
    const allowedUpdates = [
      "title",
      "description",
      "category",
      "thumbnail",
      "price",
      "status",
      "eventDate",
      "eventTime",
      "duration",
      "waitList",
      "enrolledUsers",
    ];
    const updates = {};
    for (const key of allowedUpdates) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const space = await Space.findByIdAndUpdate(id, updates, {
      new: true,
    }).populate("host", "name email avatar");

    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const joinWaitList = async (req, res) => {
  try {
    const { id } = req.params; // space ID
    const userId = req.user._id; // from auth middleware

    // Add user to waitList if not already present
    const space = await Space.findById(id);
    if (!space) {
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    }

    if (space.waitList.includes(userId)) {
      return res
        .status(400)
        .json({ success: false, message: "Already on waitlist" });
    }

    space.waitList.push(userId);
    await space.save();

    res.status(200).json({ success: true, message: "Joined waitlist" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📚 Get all spaces by a specific user (host)
export const getSpacesByHost = async (req, res) => {
  try {
    const { hostId } = req.params;
    const spaces = await Space.find({ host: hostId }).populate(
      "host",
      "name email avatar"
    );
    res.status(200).json({ success: true, spaces });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ❌ Delete a space
export const deleteSpace = async (req, res) => {
  try {
    const { id } = req.params;
    const space = await Space.findByIdAndDelete(id);
    if (!space)
      return res
        .status(404)
        .json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, message: "Space deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
