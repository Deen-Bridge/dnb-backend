import express from "express";
import authRoutes from "../../authRoutes.js";
import bookRoutes from "../../books/bookRoutes.js";
import courseRoutes from "../../courses/courseRoutes.js";
import spaceRoutes from "../../spaceRoutes.js";
import reelsRoutes from "../../reelsRoutes.js";
import notificationRoutes from "../../notificationRoutes.js";
import payoutRoutes from "../../payoutRoutes.js";
import searchRoutes from "../../searchRoutes.js";
import badgeRoutes from "../../badge.routes.js";
import certificateRoutes from "../../certificate.routes.js";
import courseBundleRoutes from "../../course-bundle.routes.js";
import categoryRoutes from "../../categoryRoutes.js";
import dateRoutes from "./dateRoutes.js";

const router = express.Router();

router.use("/auth", authRoutes);
router.use("/books", bookRoutes);
router.use("/courses", courseRoutes);
router.use("/spaces", spaceRoutes);
router.use("/reels", reelsRoutes);
router.use("/notifications", notificationRoutes);
router.use("/payouts", payoutRoutes);
router.use("/search", searchRoutes);
router.use("/badges", badgeRoutes);
router.use("/certificates", certificateRoutes);
router.use("/bundles", courseBundleRoutes);
router.use("/categories", categoryRoutes);
router.use("/dates", dateRoutes);

export default router;
