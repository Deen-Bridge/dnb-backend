import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import { catchAsync } from "../../middlewares/errorHandler.js";
import {
  listApplications,
  getApplicationById,
  getAdminDocumentSignedUrl,
  approveApplication,
  rejectApplication,
} from "../../controllers/admin/educatorVerificationAdminController.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

router.get("/", catchAsync(listApplications));
router.get("/:id", catchAsync(getApplicationById));
router.get(
  "/:id/documents/:documentIndex/signed-url",
  catchAsync(getAdminDocumentSignedUrl)
);
router.post("/:id/approve", catchAsync(approveApplication));
router.post("/:id/reject", catchAsync(rejectApplication));

export default router;
