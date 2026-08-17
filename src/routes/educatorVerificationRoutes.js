import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getMyApplication,
  submitApplication,
  getDocumentSignedUrl,
  generateUploadSignature,
} from "../controllers/educatorVerificationController.js";
import { catchAsync } from "../middlewares/errorHandler.js";

const router = express.Router();

router.use(protect);

router.get("/", catchAsync(getMyApplication));
router.get("/documents/:documentIndex/signed-url", catchAsync(getDocumentSignedUrl));
router.get("/upload-signature", catchAsync(generateUploadSignature));
router.post("/submit", catchAsync(submitApplication));

export default router;
