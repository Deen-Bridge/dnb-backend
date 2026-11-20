import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  generateCertificateController,
  getCertificateByIdController,
  getUserCertificatesController,
  downloadCertificateController,
} from "../controllers/certificate.controller.js";

const router = express.Router();

// Certificate verification is public, but downloading the generated document
// requires the certificate owner (or an authenticated administrator).
router.get("/:id/download", protect, downloadCertificateController);
router.get("/user", protect, getUserCertificatesController);
router.get("/user/:userId", protect, getUserCertificatesController);
router.get("/:id", getCertificateByIdController);

// Protected mutation route
router.post("/generate", protect, generateCertificateController);

export default router;
