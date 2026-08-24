import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getMyApplication,
  submitApplication,
  getDocumentSignedUrl,
  generateUploadSignature,
} from "../controllers/educatorVerificationController.js";

const router = express.Router();

router.use(protect);

router.get("/", getMyApplication);
router.get("/documents/:documentIndex/signed-url", getDocumentSignedUrl);
router.get("/upload-signature", generateUploadSignature);
router.post("/submit", submitApplication);

export default router;
