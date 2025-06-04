import express from "express";
import {
  getMessages,
  createMessage,
  createConversation,
  getConversations,
} from "../controllers/messageController.js";
import { protect } from "../middlewares/authMiddleware.js";
const router = express.Router();

router.get("/conversations", protect, getConversations);
router.get("/:conversationId", protect, getMessages);
router.post("/", protect, createMessage);
router.post("/conversation", protect, createConversation);

export default router;
