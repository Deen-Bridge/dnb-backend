import express from "express";
import { protect, authorizeRoles } from "../../middlewares/authMiddleware.js";
import {
  getModerationQueue,
  processModerationAction,
  getModerationHistory,
} from "../../controllers/moderation.controller.js";

const router = express.Router();

router.use(protect);
router.use(authorizeRoles("admin"));

router.get("/queue", getModerationQueue);
router.post("/action", processModerationAction);
router.post("/:flagId/action", processModerationAction);
router.get("/history", getModerationHistory);

export default router;
