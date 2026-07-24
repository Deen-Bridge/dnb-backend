import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { generateSignature } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/signature", protect, generateSignature);

export default router;
