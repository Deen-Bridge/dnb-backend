import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  generateCertificateController,
  getCertificateByIdController,
  getUserCertificatesController,
  downloadCertificateController,
} from "../controllers/certificate.controller.js";

const router = express.Router();

// Download & lookup routes (public/protected)
router.get("/:id/download", downloadCertificateController);
router.get("/user", protect, getUserCertificatesController);
router.get("/user/:userId", protect, getUserCertificatesController);
router.get("/:id", getCertificateByIdController);

// Protected mutation route
router.post("/generate", protect, generateCertificateController);

export default router;
