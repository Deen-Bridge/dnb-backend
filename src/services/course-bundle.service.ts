import CourseBundle from "../models/course-bundle.model.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import CourseProgress from "../models/CourseProgress.js";
import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";

export class CourseBundleService {
  /**
   * Calculates original total price and discount percentage.
   */
  calculateDiscount(courses, bundlePrice) {
    const originalPrice = courses.reduce((sum, course) => sum + (course.price || 0), 0);
    let discountPercentage = 0;
    if (originalPrice > 0 && bundlePrice < originalPrice) {
      discountPercentage = Math.round(((originalPrice - bundlePrice) / originalPrice) * 100 * 100) / 100;
    }
    return { originalPrice, discountPercentage };
  }

  async createBundle({ title, description, courses: courseIds, price, currency = "USDC", createdBy }) {
    if (!courseIds || !Array.isArray(courseIds) || courseIds.length === 0) {
      throw new Error("A bundle must contain at least one course");
    }

    const fetchedCourses = await Course.find({ _id: { $in: courseIds } });
    if (fetchedCourses.length !== courseIds.length) {
      throw new Error("One or more specified courses do not exist");
    }

    const { originalPrice, discountPercentage } = this.calculateDiscount(fetchedCourses, price);

    const bundle = await CourseBundle.create({
      title,
      description,
      courses: courseIds,
      price,
      currency,
      originalPrice,
      discountPercentage,
      createdBy,
    });

    return await CourseBundle.findById(bundle._id)
      .populate("courses", "title description price thumbnail category rating")
      .populate("createdBy", "name email avatar");
  }

  async getBundles(query = {}) {
    const filter = { isActive: true };
    if (query.courseId) {
      filter.courses = query.courseId;
    }
    if (query.createdBy) {
      filter.createdBy = query.createdBy;
    }
    if (query.search) {
      filter.$text = { $search: query.search };
    }

    return await CourseBundle.find(filter)
      .populate("courses", "title description price thumbnail category rating")
      .populate("createdBy", "name email avatar")
      .sort({ createdAt: -1 });
  }

  async getBundleById(bundleId) {
    const bundle = await CourseBundle.findById(bundleId)
      .populate("courses", "title description price thumbnail category rating createdBy")
      .populate("createdBy", "name email avatar");

    if (!bundle) {
      throw new Error("Course bundle not found");
    }
    return bundle;
  }

  async getBundlesByCourse(courseId) {
    return await CourseBundle.find({ courses: courseId, isActive: true })
      .populate("courses", "title description price thumbnail category rating")
      .populate("createdBy", "name email avatar");
  }

  async updateBundle(bundleId, updateData, userId, userRole) {
    const bundle = await CourseBundle.findById(bundleId);
    if (!bundle) {
      throw new Error("Course bundle not found");
    }

    if (userRole !== "admin" && bundle.createdBy.toString() !== userId.toString()) {
      throw new Error("Not authorized to update this bundle");
    }

    const allowed = new Set(["title", "description", "courses", "price", "currency"]);
    const unknown = Object.keys(updateData).filter((key) => !allowed.has(key));
    if (unknown.length) throw new Error("Only title, description, courses, price, and currency can be updated");
    if (updateData.title !== undefined && (typeof updateData.title !== "string" || !updateData.title.trim())) {
      throw new Error("title must be a non-empty string");
    }
    if (updateData.description !== undefined && typeof updateData.description !== "string") {
      throw new Error("description must be a string");
    }
    if (updateData.currency !== undefined && !getSupportedCodes().includes(updateData.currency)) {
      throw new Error("Unsupported currency");
    }
    const courseIds = updateData.courses ?? bundle.courses;
    if (!Array.isArray(courseIds) || courseIds.length === 0 || new Set(courseIds.map(String)).size !== courseIds.length || courseIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw new Error("courses must contain unique valid course ids");
    }
    const bundlePrice = updateData.price !== undefined ? Number(updateData.price) : bundle.price;
    if (!Number.isFinite(bundlePrice) || bundlePrice < 0) throw new Error("price must be a non-negative number");

    const fetchedCourses = await Course.find({ _id: { $in: courseIds }, status: "published" });
    if (fetchedCourses.length !== courseIds.length) {
      throw new Error("All bundle courses must exist and be published");
    }

    const { originalPrice, discountPercentage } = this.calculateDiscount(fetchedCourses, bundlePrice);
    updateData.price = bundlePrice;
    updateData.originalPrice = originalPrice;
    updateData.discountPercentage = discountPercentage;

    Object.assign(bundle, updateData);
    await bundle.save();

    return await CourseBundle.findById(bundle._id)
      .populate("courses", "title description price thumbnail category rating")
      .populate("createdBy", "name email avatar");
  }

  async deleteBundle(bundleId, userId, userRole) {
    const bundle = await CourseBundle.findById(bundleId);
    if (!bundle) {
      throw new Error("Course bundle not found");
    }

    if (userRole !== "admin" && bundle.createdBy.toString() !== userId.toString()) {
      throw new Error("Not authorized to delete this bundle");
    }

    bundle.isActive = false;
    await bundle.save();
    return { success: true, message: "Bundle deactivated successfully" };
  }

  async purchaseBundle(bundleId, userId) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const bundle = await CourseBundle.findById(bundleId).populate("courses").session(session);
        if (!bundle || !bundle.isActive) throw new Error("Course bundle not found or inactive");
        const user = await User.findById(userId).session(session);
        if (!user) throw new Error("User not found");

        let newlyEnrolledCount = 0;
        for (const course of bundle.courses) {
          const alreadyPurchased = user.purchasedCourses.some(
            (pc) => pc.courseId && pc.courseId.toString() === course._id.toString()
          );
          if (!alreadyPurchased) {
            user.purchasedCourses.push({ courseId: course._id, purchaseDate: new Date() });
            user.stat.coursesEnrolled = (user.stat.coursesEnrolled || 0) + 1;
            newlyEnrolledCount++;
          }
          if (!course.enrolledUsers.some((id) => id.toString() === userId.toString())) {
            course.enrolledUsers.push(userId);
            await course.save({ session });
          }
          await CourseProgress.findOneAndUpdate(
            { user: userId, course: course._id },
            { $setOnInsert: { user: userId, course: course._id, percentComplete: 0 } },
            { upsert: true, new: true, session }
          );
        }
        await user.save({ session });
        result = {
          success: true,
          message: `Enrolled successfully in bundle '${bundle.title}'`,
          bundle,
          newlyEnrolledCount,
        };
      });
      return result;
    } finally {
      await session.endSession();
    }
  }
}

export default new CourseBundleService();
