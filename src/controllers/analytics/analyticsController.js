import mongoose from "mongoose";
import Transaction from "../../models/Transaction.js";
import CourseProgress from "../../models/CourseProgress.js";
import Course from "../../models/Course.js";
import User from "../../models/User.js";
import logger from "../../config/logger.js";

const toDecimalString = (value) => {
  if (value === null || value === undefined || value === "") return "0";
  if (typeof value === "string") return value;
  return value.toString();
};

const buildDateFilter = ({ from, to }) => {
  const filter = {};
  if (from || to) {
    filter.confirmedAt = {};
    if (from) filter.confirmedAt.$gte = new Date(from);
    if (to) filter.confirmedAt.$lte = new Date(to);
  }
  return filter;
};

export const getEducatorEarnings = async (req, res) => {
  try {
    const educatorId = req.user._id;
    const { from, to, limit = 10 } = req.query;

    const match = {
      creator: educatorId,
      status: "confirmed",
      ...buildDateFilter({ from, to }),
    };

    const [summary, items] = await Promise.all([
      Transaction.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalVolume: { $sum: { $toDecimal: "$amount" } },
            transactionCount: { $sum: 1 },
            uniqueBuyers: { $addToSet: "$buyer" },
          },
        },
        {
          $project: {
            _id: 0,
            totalVolume: { $toString: "$totalVolume" },
            transactionCount: 1,
            uniqueBuyerCount: { $size: "$uniqueBuyers" },
          },
        },
      ]),
      Transaction.aggregate([
        { $match: match },
        { $group: { _id: "$itemId", title: { $first: "$itemTitle" }, totalVolume: { $sum: { $toDecimal: "$amount" } }, sales: { $sum: 1 } } },
        { $sort: { totalVolume: -1, sales: -1 } },
        { $limit: parseInt(limit, 10) || 10 },
        { $project: { _id: 0, itemId: "$_id", title: 1, totalVolume: { $toString: "$totalVolume" }, sales: 1 } },
      ]),
    ]);

    const summaryData = summary[0] || { totalVolume: "0", transactionCount: 0, uniqueBuyerCount: 0 };

    res.status(200).json({
      success: true,
      summary: {
        totalVolume: toDecimalString(summaryData.totalVolume),
        transactionCount: summaryData.transactionCount || 0,
        uniqueBuyers: summaryData.uniqueBuyerCount || 0,
      },
      items,
    });
  } catch (error) {
    logger.error("Analytics educator earnings error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch educator earnings" });
  }
};

export const getPlatformAnalytics = async (req, res) => {
  try {
    const { from, to, interval = "day", currency, network, limit = 10 } = req.query;
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Only admins can view platform analytics" });
    }

    const match = {
      status: "confirmed",
      ...buildDateFilter({ from, to }),
    };
    if (currency) match.currency = currency;
    if (network) match.network = network;

    const [summary, timeseries, topEducators, topItems] = await Promise.all([
      Transaction.aggregate([
        { $match: match },
        {
          $group: {
            _id: null,
            totalVolume: { $sum: { $toDecimal: "$amount" } },
            transactionCount: { $sum: 1 },
            uniqueBuyers: { $addToSet: "$buyer" },
            currencies: { $addToSet: "$currency" },
            networks: { $addToSet: "$network" },
          },
        },
        {
          $project: {
            _id: 0,
            totalVolume: { $toString: "$totalVolume" },
            transactionCount: 1,
            uniqueBuyerCount: { $size: "$uniqueBuyers" },
            currencies: 1,
            networks: 1,
          },
        },
      ]),
      Transaction.aggregate([
        { $match: match },
        {
          $group: {
            _id: {
              day: { $dateTrunc: { date: "$confirmedAt", unit: interval === "month" ? "month" : interval === "week" ? "week" : "day" } },
            },
            volume: { $sum: { $toDecimal: "$amount" } },
            count: { $sum: 1 },
          },
        },
        { $sort: { _id: 1 } },
        { $project: { _id: 0, bucket: "$_id.day", volume: { $toString: "$volume" }, count: 1 } },
      ]),
      Transaction.aggregate([
        { $match: match },
        { $group: { _id: "$creator", totalVolume: { $sum: { $toDecimal: "$amount" } }, sales: { $sum: 1 } } },
        { $sort: { totalVolume: -1, sales: -1 } },
        { $limit: parseInt(limit, 10) || 10 },
        { $lookup: { from: "users", localField: "_id", foreignField: "_id", as: "creatorProfile" } },
        { $unwind: { path: "$creatorProfile", preserveNullAndEmptyArrays: true } },
        { $project: { _id: 0, creatorId: "$_id", name: "$creatorProfile.name", avatar: "$creatorProfile.avatar", totalVolume: { $toString: "$totalVolume" }, sales: 1 } },
      ]),
      Transaction.aggregate([
        { $match: match },
        { $group: { _id: "$itemId", title: { $first: "$itemTitle" }, totalVolume: { $sum: { $toDecimal: "$amount" } }, sales: { $sum: 1 } } },
        { $sort: { totalVolume: -1, sales: -1 } },
        { $limit: parseInt(limit, 10) || 10 },
        { $project: { _id: 0, itemId: "$_id", title: 1, totalVolume: { $toString: "$totalVolume" }, sales: 1 } },
      ]),
    ]);

    const summaryData = summary[0] || { totalVolume: "0", transactionCount: 0, uniqueBuyerCount: 0, currencies: [], networks: [] };

    res.status(200).json({
      success: true,
      summary: {
        totalVolume: toDecimalString(summaryData.totalVolume),
        transactionCount: summaryData.transactionCount || 0,
        uniqueBuyers: summaryData.uniqueBuyerCount || 0,
        currencies: summaryData.currencies || [],
        networks: summaryData.networks || [],
      },
      timeseries,
      topEducators: topEducators || [],
      topItems: topItems || [],
    });
  } catch (error) {
    logger.error("Platform analytics error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch platform analytics" });
  }
};

export const getCourseProgress = async (req, res) => {
  try {
    const courseId = req.params.id;
    const userId = req.user._id;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const isOwner = course.createdBy && course.createdBy.toString() === userId.toString();
    const isEnrolled = course.enrolledUsers?.some((entry) => entry.toString() === userId.toString());
    if (!isOwner && !isEnrolled) {
      return res.status(403).json({ success: false, message: "You do not have access to this course" });
    }

    let progress = await CourseProgress.findOne({ user: userId, course: courseId });
    if (!progress) {
      const lessonCount = (course.sections || []).reduce((count, section) => count + (section.lessons || []).length, 0) || 1;
      progress = await CourseProgress.create({
        user: userId,
        course: courseId,
        lessonsCompleted: [],
        lastLesson: null,
        lastPositionSeconds: 0,
        percentComplete: 0,
      });
      progress = progress.toObject();
    }

    res.status(200).json({ success: true, progress });
  } catch (error) {
    logger.error("Get course progress error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch course progress" });
  }
};

export const updateCourseProgress = async (req, res) => {
  try {
    const courseId = req.params.id;
    const userId = req.user._id;
    const { lessonId, lastPositionSeconds } = req.body;
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ success: false, message: "Course not found" });

    const isOwner = course.createdBy && course.createdBy.toString() === userId.toString();
    const isEnrolled = course.enrolledUsers?.some((entry) => entry.toString() === userId.toString());
    if (!isOwner && !isEnrolled) {
      return res.status(403).json({ success: false, message: "You do not have access to this course" });
    }

    const lessonCount = (course.sections || []).reduce((count, section) => count + (section.lessons || []).length, 0) || 1;

    let progress = await CourseProgress.findOne({ user: userId, course: courseId });
    if (!progress) {
      progress = await CourseProgress.create({
        user: userId,
        course: courseId,
        lessonsCompleted: [],
        lastLesson: null,
        lastPositionSeconds: 0,
        percentComplete: 0,
      });
    }

    if (lessonId) {
      const lessonObjectId = new mongoose.Types.ObjectId(lessonId);
      progress.lessonsCompleted = Array.from(new Set([...(progress.lessonsCompleted || []), lessonObjectId]));
    }

    progress.lastLesson = lessonId ? new mongoose.Types.ObjectId(lessonId) : progress.lastLesson;
    progress.lastPositionSeconds = lastPositionSeconds ?? progress.lastPositionSeconds;
    const percent = Math.min(100, Math.round((progress.lessonsCompleted.length / lessonCount) * 100));
    progress.percentComplete = percent;
    if (percent >= 100) progress.completedAt = progress.completedAt || new Date();
    await progress.save();

    res.status(200).json({ success: true, progress });
  } catch (error) {
    logger.error("Update course progress error:", error);
    res.status(500).json({ success: false, message: "Failed to update course progress" });
  }
};

export const getUserLearning = async (req, res) => {
  try {
    const userId = req.user._id;
    const { status = "in-progress" } = req.query;
    const progressRecords = await CourseProgress.find({ user: userId }).sort({ updatedAt: -1 }).populate("course");
    const courses = progressRecords
      .map((record) => ({
        _id: record.course?._id,
        title: record.course?.title || "Course",
        percentComplete: record.percentComplete || 0,
        lastLesson: record.lastLesson,
        lastPositionSeconds: record.lastPositionSeconds || 0,
        completedAt: record.completedAt,
        updatedAt: record.updatedAt,
      }))
      .filter((entry) => {
        if (status === "completed") return entry.percentComplete >= 100;
        return entry.percentComplete < 100;
      });

    res.status(200).json({ success: true, courses });
  } catch (error) {
    logger.error("Get user learning error:", error);
    res.status(500).json({ success: false, message: "Failed to fetch learning dashboard" });
  }
};
