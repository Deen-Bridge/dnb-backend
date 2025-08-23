import User from "../models/User.js";

export const purchaseCourse = async (req, res) => {
  try {
    const userId = req.user._id; // from auth middleware
    const { courseId } = req.body;

    const user = await User.findById(userId);
    if (!user) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    // Prevent duplicate purchase
    const alreadyPurchased = user.purchasedCourses.some(
      (c) => c.courseId.toString() === courseId
    );
    if (alreadyPurchased) {
      return res
        .status(400)
        .json({ success: false, message: "Course already purchased" });
    }

    user.purchasedCourses.push({ courseId });
    // Increment coursesEnrolled stat
    if (!user.stat) user.stat = {};
    user.stat.coursesEnrolled = (user.stat.coursesEnrolled || 0) + 1;

    await user.save();

    res.status(200).json({ success: true, message: "Course purchased" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
    console.error("Purchase Course Error:", error);
  }
};
