import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
} from "../controllers/messaging.controller.js";

const router = express.Router();

router.get("/conversations", protect, getConversations);
router.post("/conversations/:userId", protect, getOrCreateConversation);
router.get("/conversations/:conversationId/messages", protect, getMessages);
router.post("/conversations/:conversationId/messages", protect, sendMessage);
router.post("/conversations/:conversationId/read", protect, markAsRead);

export default router;
