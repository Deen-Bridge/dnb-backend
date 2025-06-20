import User from "../models/User.js";
import cloudinary from "../../utils/cloudinary.js";

// Update user profile (including avatar upload to Cloudinary)
export const updateUser = async (req, res) => {
  try {
    const updates = req.body;
    let avatarUrl = updates.avatar;

    // If avatar file is uploaded, upload to Cloudinary with timeout
    if (req.file) {
      try {
        const result = await Promise.race([
          new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream(
              { folder: "user-avatars" },
              (error, result) => {
                if (error) reject(error);
                else resolve(result);
              }
            );
            stream.end(req.file.buffer);
          }),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Cloudinary upload timeout")),
              10000
            )
          ),
        ]);
        avatarUrl = result.secure_url;
      } catch (uploadError) {
        console.error("Avatar upload error:", uploadError);
        return res.status(500).json({
          success: false,
          message: "Failed to upload avatar. Please try again.",
        });
      }
    }

    // Validate updates
    const allowedUpdates = [
      "name",
      "email",
      "bio",
      "age",
      "avatar",
      "language",
      "gender",
      "country",
      "interests",
    ];
    const filteredUpdates = Object.keys(updates)
      .filter((key) => allowedUpdates.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {});

    if (avatarUrl) filteredUpdates.avatar = avatarUrl;

    const user = await User.findByIdAndUpdate(req.params.id, filteredUpdates, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Profile update error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to update profile. Please try again.",
      error: error.message,
    });
  }
};

// Get user by ID
export const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      user,
    });
  } catch (error) {
    console.error("Get user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user. Please try again.",
      error: error.message,
    });
  }
};

// Delete user
export const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Delete user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete user. Please try again.",
      error: error.message,
    });
  }
};
