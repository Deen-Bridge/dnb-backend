import Space from "../models/Space.js";

// 📚 Get all spaces
export const getSpaces = async (_req, res) => {
  try {
    const spaces = await Space.find()
      .populate("host.userId", "name email avatar")
      .populate("speakers.userId", "name email avatar");
    res.status(200).json({ success: true, spaces });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// 📖 Get a single space by ID
export const getSpaceById = async (req, res) => {
  try {
    const space = await Space.findById(req.params.id)
      .populate("host.userId", "name email avatar")
      .populate("speakers.userId", "name email avatar");
    if (!space) return res.status(404).json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ➕ Create a new space
export const createSpace = async (req, res) => {
  try {
    const { title, description, category, thumbnail, price, status, startTime, duration, speakers } = req.body;
    // Host is the logged-in user
    const user = req.user; // from auth middleware
    const host = {
      userId: user._id,
      name: user.name,
      image: user.avatar,
      bio: user.bio || "",
    };
    const space = await Space.create({
      title,
      description,
      category,
      thumbnail,
      price: price || 0,
      status: status || "upcoming",
      startTime,
      duration,
      host,
      speakers: speakers || [],
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
    const updates = req.body;
    const space = await Space.findByIdAndUpdate(id, updates, { new: true })
      .populate("host.userId", "name email avatar")
      .populate("speakers.userId", "name email avatar");
    if (!space) return res.status(404).json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, space });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// ❌ Delete a space
export const deleteSpace = async (req, res) => {
  try {
    const { id } = req.params;
    const space = await Space.findByIdAndDelete(id);
    if (!space) return res.status(404).json({ success: false, message: "Space not found" });
    res.status(200).json({ success: true, message: "Space deleted" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};