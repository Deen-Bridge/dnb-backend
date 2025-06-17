import express from "express";
import {
  getMessages,
  createMessage,
  createConversation,
  getConversations,
} from "../controllers/messageController.js";
import { protect } from "../middlewares/authMiddleware.js";
const router = express.Router();

// More specific routes first
router.get("/conversations", protect, getConversations);
router.post("/conversation", protect, createConversation);

// Generic routes last
router.get("/:conversationId", protect, getMessages);
router.post("/", protect, createMessage);

export default router;
