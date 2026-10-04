import express from "express";
import { authorizeRoles, protect } from "../../middlewares/authMiddleware.js";
import { idempotency } from "../../middlewares/idempotency.js";
import {
  getScholarshipContribution,
  getScholarshipState,
  getScholarshipMilestoneReports,
  initializeScholarshipContribution,
  initializeScholarshipMilestoneApproval,
  initializeScholarshipRefund,
  reviewScholarshipMilestoneReport,
  submitScholarshipMilestoneReport,
  submitScholarshipContribution,
} from "../../controllers/stellar/scholarshipController.js";
import {
  decideScholarshipApplication,
  getMyScholarshipApplication,
  getScholarshipApplicationConfig,
  listScholarshipApplicationsForReview,
  reviewScholarshipApplication,
  submitScholarshipApplication,
} from "../../controllers/stellar/scholarshipApplicationController.js";

const router = express.Router();

router.use(protect);
router.get("/applications/config", getScholarshipApplicationConfig);
router.post("/applications", submitScholarshipApplication);
router.get("/applications/me", getMyScholarshipApplication);
router.get("/applications/review", authorizeRoles("admin"), listScholarshipApplicationsForReview);
router.post("/applications/:applicationId/reviews", authorizeRoles("admin"), reviewScholarshipApplication);
router.post("/applications/:applicationId/decision", authorizeRoles("admin"), decideScholarshipApplication);
router.get("/state", getScholarshipState);
router.get("/milestones/reports", getScholarshipMilestoneReports);
router.post("/milestones/:index/reports", idempotency(), submitScholarshipMilestoneReport);
router.post(
  "/milestones/:index/reports/:reportId/review",
  authorizeRoles("admin"),
  idempotency(),
  reviewScholarshipMilestoneReport
);
router.post("/contributions/initialize", idempotency(), initializeScholarshipContribution);
router.post("/contributions/submit", idempotency(), submitScholarshipContribution);
router.get("/contributions/:contributionId", getScholarshipContribution);
router.post("/refunds/initialize", idempotency(), initializeScholarshipRefund);
router.post(
  "/milestones/:index/release/initialize",
  authorizeRoles("admin"),
  idempotency(),
  initializeScholarshipMilestoneApproval
);

export default router;
