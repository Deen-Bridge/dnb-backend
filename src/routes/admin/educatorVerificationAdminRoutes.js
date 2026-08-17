import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  listApplications,
  getApplicationById,
  getAdminDocumentSignedUrl,
  approveApplication,
  rejectApplication,
} from "../../controllers/admin/educatorVerificationAdminController.js";

const router = express.Router();

router.use(protect, authorizeRoles("admin"));

router.get("/", listApplications);
router.get("/:id", getApplicationById);
router.get(
  "/:id/documents/:documentIndex/signed-url",
  getAdminDocumentSignedUrl
);
router.post("/:id/approve", approveApplication);
router.post("/:id/reject", rejectApplication);

export default router;
