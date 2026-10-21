import mongoose from "mongoose";
import Course from "../models/Course.js";
import CourseProgress from "../models/CourseProgress.js";
import User from "../models/User.js";
import { catchAsync, APIError } from "../middlewares/errorHandler.js";

export const getEducatorAnalytics = catchAsync(async (req, res) => {
  const { id } = req.params;
  const { from, to } = req.query;

  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new APIError("Invalid educator ID", 400);
  }

  const educatorId = new mongoose.Types.ObjectId(id);

  // Verify the educator exists
  const educator = await User.findById(educatorId).select("name role").lean();
  if (!educator) {
    throw new APIError("Educator not found", 404);
  }

  // Build optional date filter for course creation
  const courseDateFilter = {};
  if (from || to) {
    courseDateFilter.createdAt = {};
    if (from) courseDateFilter.createdAt.$gte = new Date(from);
    if (to) courseDateFilter.createdAt.$lte = new Date(to);
  }

  // Fetch all courses created by this educator
  const courses = await Course.find({ createdBy: educatorId, ...courseDateFilter })
    .select("title enrolledUsers sections createdAt")
    .lean();

  const courseIds = courses.map((c) => c._id);

  if (courseIds.length === 0) {
    return res.status(200).json({
      success: true,
      data: {
        educator: { _id: educatorId, name: educator.name },
        total_courses: 0,
        total_students: 0,
        courses: [],
      },
    });
  }

  // Aggregate progress data for all courses in one query
  const progressPipeline = [
    { $match: { course: { $in: courseIds } } },
    {
      $group: {
        _id: "$course",
        enrolled: { $addToSet: "$user" },
        completed: {
          $sum: { $cond: [{ $gt: ["$percentComplete", 99] }, 1, 0] },
        },
        avgProgress: { $avg: "$percentComplete" },
        totalProgressRecords: { $sum: 1 },
      },
    },
  ];

  // Build progress match filter based on date range (for updatedAt)
  if (from || to) {
    const dateFilter = {};
    if (from) dateFilter.$gte = new Date(from);
    if (to) dateFilter.$lte = new Date(to);
    progressPipeline[0].$match.updatedAt = dateFilter;
  }

  const progressData = await CourseProgress.aggregate(progressPipeline);
  const progressByCourse = new Map(progressData.map((p) => [p._id.toString(), p]));

  // Build per-course stats
  const coursesStats = courses.map((course) => {
    const stats = progressByCourse.get(course._id.toString());
    const enrolledCount = stats ? stats.enrolled.length : course.enrolledUsers?.length || 0;
    const completedCount = stats ? stats.completed : 0;
    const avgProgress = stats ? Math.round(stats.avgProgress * 10) / 10 : 0;
    const totalLessons = course.sections?.reduce(
      (sum, s) => sum + (s.lessons?.length || 0),
      0
    ) || 0;

    return {
      _id: course._id,
      title: course.title,
      enrolled: enrolledCount,
      completed: completedCount,
      avg_progress: avgProgress,
      total_lessons: totalLessons,
      completion_rate: enrolledCount > 0 ? Math.round((completedCount / enrolledCount) * 1000) / 10 : 0,
    };
  });

  // Unique students across all courses
  const allStudentIds = new Set();
  courses.forEach((c) => {
    (c.enrolledUsers || []).forEach((u) => allStudentIds.add(u.toString()));
  });

  res.status(200).json({
    success: true,
    data: {
      educator: { _id: educatorId, name: educator.name },
      total_courses: courses.length,
      total_students: allStudentIds.size,
      courses: coursesStats,
    },
  });
});
