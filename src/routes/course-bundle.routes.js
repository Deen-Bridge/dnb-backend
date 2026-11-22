import express from "express";
import { protect, requireVerifiedEducator } from "../middlewares/authMiddleware.js";
import { validate } from "../middlewares/validate.js";
import {
  createBundle,
  getBundles,
  getBundleById,
  getBundlesByCourse,
  updateBundle,
  deleteBundle,
  purchaseBundle,
} from "../controllers/course-bundle.controller.js";
import {
  bundleActionValidation,
  bundleIdValidation,
  bundlesByCourseValidation,
  createBundleValidation,
  listBundlesValidation,
  updateBundleValidation,
} from "../validators/courseBundleValidators.js";

const router = express.Router();

// Public routes (paginated; page size capped at MAX_BUNDLE_PAGE_SIZE)
router.get("/", listBundlesValidation, validate, getBundles);
router.get("/course/:courseId", bundlesByCourseValidation, validate, getBundlesByCourse);
router.get("/:id", bundleIdValidation, validate, getBundleById);

// Protected routes.
// Authorization: creating a bundle requires a verified educator (or admin);
// update/delete are limited to the bundle owner or an admin, and non-admins
// may only bundle courses they created. Ownership is enforced in the service
// so it also covers the course set, and denials are audited by the controller.
router.post("/", protect, requireVerifiedEducator, createBundleValidation, validate, createBundle);
router.put("/:id", protect, updateBundleValidation, validate, updateBundle);
router.delete("/:id", protect, bundleActionValidation, validate, deleteBundle);
router.post("/:id/purchase", protect, bundleActionValidation, validate, purchaseBundle);

export default router;
