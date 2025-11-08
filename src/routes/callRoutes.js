import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import { createSpaceMeetingToken } from "../controllers/callController.js";

const router = express.Router();

router.post("/token", protect, createSpaceMeetingToken);

export default router;

