import mongoose from "mongoose";
import logger from "../../config/logger.js";
import Course from "../../models/Course.js";
import CourseProgress from "../../models/CourseProgress.js";
import certificateService from "../../services/certificate.service.js";
import badgeService from "../../services/badge.service.js";

const toObjectId = (value) => {
  if (!value) return null;
  try {
    return new mongoose.Types.ObjectId(value);
  } catch (error) {
    return null;
  }
};

export const getCourseProgress = async (req, res) => {
  try {
    const courseId = req.params.id;
    const userId = req.user._id;

    const progress = await CourseProgress.findOne({ user: userId, course: courseId })
      .lean();

    if (!progress) {
      return res.status(200).json({ success: true, progress: null });
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
    if (!course) {
      return res.status(404).json({ success: false, message: "Course not found" });
    }

    const lessons = (course.sections || []).flatMap((section) => section.lessons || []);
    if (!lessons.length) {
      return res.status(400).json({ success: false, message: "Course has no lessons" });
    }

    const lessonObjectId = toObjectId(lessonId);
    const lessonExists = lessons.some((lesson) => lesson._id?.toString() === lessonObjectId?.toString());
    if (!lessonExists) {
      return res.status(400).json({ success: false, message: "Lesson not found" });
    }

    const existing = await CourseProgress.findOne({ user: userId, course: courseId });
    const completedLessons = new Set(existing?.lessonsCompleted?.map((item) => item.toString()) || []);

    if (lessonObjectId) {
      completedLessons.add(lessonObjectId.toString());
    }

    const totalLessons = lessons.length;
    const completedCount = completedLessons.size;
    const percentComplete = Math.min(100, Math.round((completedCount / totalLessons) * 100));

    const progressData = {
      user: userId,
      course: courseId,
      lessonsCompleted: Array.from(completedLessons).map((value) => toObjectId(value)),
      lastLesson: lessonObjectId,
      lastPositionSeconds: Number(lastPositionSeconds || 0),
      percentComplete,
      completedAt: percentComplete >= 100 ? new Date() : null,
    };

    const progress = await CourseProgress.findOneAndUpdate(
      { user: userId, course: courseId },
      { $set: progressData },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    res.status(200).json({ success: true, progress });
  } catch (error) {
    logger.error("Update course progress error:", error);
    res.status(500).json({ success: false, message: "Failed to update course progress" });
  }
};
