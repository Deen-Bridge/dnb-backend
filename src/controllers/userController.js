import User from "../models/User.js";
import cloudinary from "../utils/cloudinary.js";
import Course from "../models/Course.js";
import Book from "../models/Book.js";

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

// Follow a user
export const followUser = async (req, res) => {
  try {
    const { userId } = req.params; // ID of user to follow
    const currentUserId = req.user._id; // Current user from auth middleware

    // Check if user is trying to follow themselves
    if (currentUserId.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot follow yourself",
      });
    }

    // Check if user to follow exists
    const userToFollow = await User.findById(userId);
    if (!userToFollow) {
      return res.status(404).json({
        success: false,
        message: "User to follow not found",
      });
    }

    // Check if already following
    const currentUser = await User.findById(currentUserId);
    if (currentUser.following.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "You are already following this user",
      });
    }

    // Add to following and followers
    await User.findByIdAndUpdate(currentUserId, {
      $push: { following: userId },
    });

    await User.findByIdAndUpdate(userId, {
      $push: { followers: currentUserId },
    });

    res.status(200).json({
      success: true,
      message: "Successfully followed user",
    });
  } catch (error) {
    console.error("Follow user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to follow user. Please try again.",
      error: error.message,
    });
  }
};

// Unfollow a user
export const unfollowUser = async (req, res) => {
  try {
    const { userId } = req.params; // ID of user to unfollow
    const currentUserId = req.user._id; // Current user from auth middleware

    // Check if user is trying to unfollow themselves
    if (currentUserId.toString() === userId) {
      return res.status(400).json({
        success: false,
        message: "You cannot unfollow yourself",
      });
    }

    // Check if user to unfollow exists
    const userToUnfollow = await User.findById(userId);
    if (!userToUnfollow) {
      return res.status(404).json({
        success: false,
        message: "User to unfollow not found",
      });
    }

    // Check if not following
    const currentUser = await User.findById(currentUserId);
    if (!currentUser.following.includes(userId)) {
      return res.status(400).json({
        success: false,
        message: "You are not following this user",
      });
    }

    // Remove from following and followers
    await User.findByIdAndUpdate(currentUserId, {
      $pull: { following: userId },
    });

    await User.findByIdAndUpdate(userId, {
      $pull: { followers: currentUserId },
    });

    res.status(200).json({
      success: true,
      message: "Successfully unfollowed user",
    });
  } catch (error) {
    console.error("Unfollow user error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to unfollow user. Please try again.",
      error: error.message,
    });
  }
};

// Get user's followers
export const getFollowers = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate("followers", "name email avatar role bio")
      .select("followers");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      followers: user.followers,
      count: user.followers.length,
    });
  } catch (error) {
    console.error("Get followers error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch followers. Please try again.",
      error: error.message,
    });
  }
};

// Get users that a user is following
export const getFollowing = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId)
      .populate("following", "name email avatar role bio")
      .select("following");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      following: user.following,
      count: user.following.length,
    });
  } catch (error) {
    console.error("Get following error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch following. Please try again.",
      error: error.message,
    });
  }
};

// Get follower count only
export const getFollowersCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("followers");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      followersCount: user.followers.length,
    });
  } catch (error) {
    console.error("Get followers count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch followers count. Please try again.",
      error: error.message,
    });
  }
};

// Get following count only
export const getFollowingCount = async (req, res) => {
  try {
    const { userId } = req.params;

    const user = await User.findById(userId).select("following");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.status(200).json({
      success: true,
      followingCount: user.following.length,
    });
  } catch (error) {
    console.error("Get following count error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch following count. Please try again.",
      error: error.message,
    });
  }
};

// Check if current user is following another user
export const checkIfFollowing = async (req, res) => {
  try {
    const { userId } = req.params; // User to check if following
    const currentUserId = req.user._id; // Current user from auth middleware

    const currentUser = await User.findById(currentUserId).select("following");

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "Current user not found",
      });
    }

    const isFollowing = currentUser.following.includes(userId);

    res.status(200).json({
      success: true,
      isFollowing,
    });
  } catch (error) {
    console.error("Check following status error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to check following status. Please try again.",
      error: error.message,
    });
  }
};

// Get personalized recommendations based on user interests
export const getRecommendations = async (req, res) => {
  try {
    const currentUserId = req.user._id; // Current user from auth middleware

    // Get current user with interests
    const currentUser = await User.findById(currentUserId).select("interests");

    if (!currentUser) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // If user has no interests, return empty recommendations
    if (!currentUser.interests || currentUser.interests.length === 0) {
      return res.status(200).json({
        success: true,
        recommendations: {
          courses: [],
          books: [],
          message:
            "No interests set. Please update your profile with interests to get personalized recommendations.",
        },
      });
    }

    // Create regex patterns for case-insensitive matching
    const interestPatterns = currentUser.interests.map(
      (interest) => new RegExp(interest, "i")
    );

    // Find courses that match user interests
    const recommendedCourses = await Course.find({
      category: { $in: interestPatterns },
    })
      .select("_id title description category price thumbnail createdBy")
      .populate("createdBy", "name avatar")
      .limit(5)
      .lean();

    // Find books that match user interests
    const recommendedBooks = await Book.find({
      category: { $in: interestPatterns },
    })
      .select("_id title description category price image author")
      .populate("author", "name avatar")
      .limit(5)
      .lean();

    // If not enough matches found, get some popular courses/books as fallback
    let fallbackCourses = [];
    let fallbackBooks = [];

    if (recommendedCourses.length < 5) {
      const remainingCount = 5 - recommendedCourses.length;
      fallbackCourses = await Course.find({
        _id: { $nin: recommendedCourses.map((c) => c._id) },
      })
        .select("_id title description category price thumbnail createdBy")
        .populate("createdBy", "name avatar")
        .limit(remainingCount)
        .lean();
    }

    if (recommendedBooks.length < 5) {
      const remainingCount = 5 - recommendedBooks.length;
      fallbackBooks = await Book.find({
        _id: { $nin: recommendedBooks.map((b) => b._id) },
      })
        .select("_id title description category price image author")
        .populate("author", "name avatar")
        .limit(remainingCount)
        .lean();
    }

    // Combine recommended and fallback results
    const finalCourses = [...recommendedCourses, ...fallbackCourses].slice(
      0,
      5
    );
    const finalBooks = [...recommendedBooks, ...fallbackBooks].slice(0, 5);

    res.status(200).json({
      success: true,
      recommendations: {
        courses: finalCourses,
        books: finalBooks,
        userInterests: currentUser.interests,
        coursesCount: finalCourses.length,
        booksCount: finalBooks.length,
      },
    });
  } catch (error) {
    console.error("Get recommendations error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch recommendations. Please try again.",
      error: error.message,
    });
  }
};

// Get user statistics
export const getUserStats = async (req, res) => {
  try {
    const userId = req.params.id;

    // Get user
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Get courses enrolled
    const coursesEnrolled = await Course.countDocuments({
      enrolledUsers: userId,
    });

    // Get books purchased/read (assuming books have a similar enrolledUsers or purchasedBy field)
    const booksRead = await Book.countDocuments({
      purchasedBy: userId,
    });

    // Calculate total uptime (days since user joined)
    const accountCreatedDate = user.createdAt || new Date();
    const now = new Date();
    const diffTime = Math.abs(now - accountCreatedDate);
    const totalUptime = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); // Convert to days

    // Return stats
    res.status(200).json({
      success: true,
      coursesEnrolled,
      booksRead,
      upcomingSessions: 0, // Placeholder - implement when sessions are available
      messagesUnread: 0, // Placeholder - implement when messages are available
      totalUptime,
    });
  } catch (error) {
    console.error("Get user stats error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch user statistics.",
      error: error.message,
    });
  }
};
