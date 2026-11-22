import CourseBundle from "../models/course-bundle.model.js";
import Course from "../models/Course.js";
import User from "../models/User.js";
import CourseProgress from "../models/CourseProgress.js";
import mongoose from "mongoose";
import { APIError } from "../middlewares/errorHandler.js";
import { getSupportedCodes } from "../config/assets.js";
import { buildPageMeta } from "../utils/pagination.js";
import {
  BUNDLE_SORTS,
  DEFAULT_BUNDLE_PAGE_SIZE,
  DEFAULT_BUNDLE_SORT,
  MAX_BUNDLE_COURSES,
  MAX_BUNDLE_PAGE_SIZE,
} from "../validators/courseBundleValidators.js";

const UPDATABLE_FIELDS = new Set(["title", "description", "courses", "price", "currency"]);
const COURSE_SUMMARY_FIELDS = "title description price thumbnail category rating";
const CREATOR_SUMMARY_FIELDS = "name email avatar";
// Bounds every bundle read so a slow index scan cannot pin a connection.
const LIST_MAX_TIME_MS = 5000;

const isAdmin = (role) => role === "admin";

const invalid = (field, message) =>
  new APIError("Validation failed", 400, true, [{ field, message }]);

const clampPageSize = (limit) =>
  Math.min(Math.max(Number.parseInt(limit, 10) || DEFAULT_BUNDLE_PAGE_SIZE, 1), MAX_BUNDLE_PAGE_SIZE);

export class CourseBundleService {
  calculateDiscount(courses, bundlePrice) {
    const originalPrice = courses.reduce((sum, course) => sum + (course.price || 0), 0);
    let discountPercentage = 0;
    if (originalPrice > 0 && bundlePrice < originalPrice) {
      discountPercentage = Math.round(((originalPrice - bundlePrice) / originalPrice) * 100 * 100) / 100;
    }
    return { originalPrice, discountPercentage };
  }

  /**
   * Load the courses a bundle will contain and enforce who may bundle them:
   * admins may bundle any course, everyone else only courses they created.
   * The route validators already guarantee a bounded list of unique ids; the
   * checks here keep the service safe for non-HTTP callers.
   */
  async resolveBundleCourses(courseIds, actor, { publishedOnly = false } = {}) {
    if (!Array.isArray(courseIds) || courseIds.length === 0 || courseIds.length > MAX_BUNDLE_COURSES) {
      throw invalid("courses", `A bundle must contain between 1 and ${MAX_BUNDLE_COURSES} courses`);
    }
    const ids = courseIds.map(String);
    if (new Set(ids).size !== ids.length || ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
      throw invalid("courses", "courses must contain unique valid course ids");
    }

    const filter = { _id: { $in: ids }, ...(publishedOnly && { status: "published" }) };
    const courses = await Course.find(filter).select("price createdBy").lean();
    if (courses.length !== ids.length) {
      throw invalid(
        "courses",
        publishedOnly
          ? "All bundle courses must exist and be published"
          : "One or more specified courses do not exist"
      );
    }

    if (!isAdmin(actor.role)) {
      const actorId = String(actor.id);
      if (courses.some((course) => String(course.createdBy) !== actorId)) {
        throw new APIError("You can only bundle courses you created", 403);
      }
    }
    return courses;
  }

  assertCanModify(bundle, actor) {
    if (!isAdmin(actor.role) && String(bundle.createdBy) !== String(actor.id)) {
      throw new APIError("You are not authorized to modify this bundle", 403);
    }
  }

  populated(bundleId) {
    return CourseBundle.findById(bundleId)
      .populate("courses", COURSE_SUMMARY_FIELDS)
      .populate("createdBy", CREATOR_SUMMARY_FIELDS);
  }

  /**
   * @param {object} input
   * @param {{id: string, role: string}} actor - authenticated caller
   */
  async createBundle({ title, description, courses: courseIds, price, currency = "USDC" }, actor) {
    if (!getSupportedCodes().includes(currency)) {
      throw invalid("currency", "currency is not supported");
    }

    const courses = await this.resolveBundleCourses(courseIds, actor);
    const { originalPrice, discountPercentage } = this.calculateDiscount(courses, price);

    const bundle = await CourseBundle.create({
      title,
      description,
      courses: courseIds,
      price,
      currency,
      originalPrice,
      discountPercentage,
      createdBy: actor.id,
    });

    return await this.populated(bundle._id);
  }

  /**
   * Paginated list of active bundles. Results are always bounded by
   * MAX_BUNDLE_PAGE_SIZE and sorted with an `_id` tiebreaker so consecutive
   * pages never repeat or skip documents with equal sort keys.
   */
  async getBundles({ courseId, createdBy, search, page = 1, limit, sort } = {}) {
    const filter = { isActive: true };
    if (courseId) filter.courses = courseId;
    if (createdBy) filter.createdBy = createdBy;
    if (search) filter.$text = { $search: String(search) };

    const pageSize = clampPageSize(limit);
    const pageNumber = Math.max(Number.parseInt(page, 10) || 1, 1);
    const order = { ...(BUNDLE_SORTS[sort] || BUNDLE_SORTS[DEFAULT_BUNDLE_SORT]), _id: -1 };

    const [bundles, total] = await Promise.all([
      CourseBundle.find(filter)
        .populate("courses", COURSE_SUMMARY_FIELDS)
        .populate("createdBy", CREATOR_SUMMARY_FIELDS)
        .sort(order)
        .skip((pageNumber - 1) * pageSize)
        .limit(pageSize)
        .maxTimeMS(LIST_MAX_TIME_MS)
        .lean(),
      CourseBundle.countDocuments(filter).maxTimeMS(LIST_MAX_TIME_MS),
    ]);

    return { bundles, pagination: buildPageMeta(total, pageNumber, pageSize) };
  }

  async getBundleById(bundleId) {
    const bundle = await CourseBundle.findById(bundleId)
      .populate("courses", `${COURSE_SUMMARY_FIELDS} createdBy`)
      .populate("createdBy", CREATOR_SUMMARY_FIELDS);

    if (!bundle) {
      throw new APIError("Course bundle not found", 404);
    }
    return bundle;
  }

  async getBundlesByCourse(courseId, options = {}) {
    return this.getBundles({ ...options, courseId });
  }

  /**
   * Only title, description, courses, price and currency can change. Pricing
   * metadata is always recomputed server-side from the final course set.
   */
  async updateBundle(bundleId, updateData, actor) {
    const unknown = Object.keys(updateData).filter((key) => !UPDATABLE_FIELDS.has(key));
    if (unknown.length) {
      throw invalid(unknown[0], "Only title, description, courses, price, and currency can be updated");
    }
    if (updateData.currency !== undefined && !getSupportedCodes().includes(updateData.currency)) {
      throw invalid("currency", "currency is not supported");
    }

    const bundle = await CourseBundle.findById(bundleId);
    if (!bundle) {
      throw new APIError("Course bundle not found", 404);
    }
    this.assertCanModify(bundle, actor);
    if (!bundle.isActive) {
      throw new APIError("Inactive bundles cannot be updated", 409);
    }

    const changes = { ...updateData };
    if (changes.courses || changes.price !== undefined) {
      const courseIds = changes.courses || bundle.courses.map(String);
      const bundlePrice = changes.price !== undefined ? changes.price : bundle.price;
      // Re-checking ownership on unchanged courses is deliberate: an owner
      // repricing a bundle must still own everything it sells.
      const courses = await this.resolveBundleCourses(courseIds, actor, { publishedOnly: true });
      Object.assign(changes, this.calculateDiscount(courses, bundlePrice));
    }

    Object.assign(bundle, changes);
    await bundle.save();

    return await this.populated(bundle._id);
  }

  /** Soft-deletes the bundle. Repeating the call is a no-op success. */
  async deleteBundle(bundleId, actor) {
    const bundle = await CourseBundle.findById(bundleId);
    if (!bundle) {
      throw new APIError("Course bundle not found", 404);
    }
    this.assertCanModify(bundle, actor);

    if (bundle.isActive) {
      bundle.isActive = false;
      await bundle.save();
    }
    return { success: true, message: "Bundle deactivated successfully" };
  }

  async purchaseBundle(bundleId, userId) {
    const session = await mongoose.startSession();
    try {
      let result;
      await session.withTransaction(async () => {
        const bundle = await CourseBundle.findById(bundleId)
          .populate("courses")
          .session(session);
        if (!bundle || !bundle.isActive) {
          throw new APIError("Course bundle not found or inactive", 404);
        }

        const user = await User.findById(userId).session(session);
        if (!user) {
          throw new APIError("User not found", 404);
        }

        let newlyEnrolledCount = 0;

        for (const course of bundle.courses) {
          const courseIdStr = course._id.toString();
          const alreadyPurchased = user.purchasedCourses.some(
            (pc) => pc.courseId && pc.courseId.toString() === courseIdStr
          );

          if (!alreadyPurchased) {
            user.purchasedCourses.push({
              courseId: course._id,
              purchaseDate: new Date(),
            });
            user.stat.coursesEnrolled = (user.stat.coursesEnrolled || 0) + 1;
            newlyEnrolledCount++;
          }

          const isEnrolledInCourse = course.enrolledUsers.some(
            (uId) => uId.toString() === userId.toString()
          );
          if (!isEnrolledInCourse) {
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
