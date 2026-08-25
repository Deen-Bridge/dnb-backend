import { Request, Response } from "express";
import messagingService from "../services/messaging.service.ts";

export const getOrCreateConversation = async (req: Request, res: Response) => {
  try {
    const { userId } = req.params;
    const currentUserId = (req as any).user._id;

    const conversation = await messagingService.getOrCreateConversation(
      currentUserId.toString(),
      userId
    );

    res.status(200).json({ success: true, conversation });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getConversations = async (req: Request, res: Response) => {
  try {
    const userId = (req as any).user._id;

    const conversations = await messagingService.getConversations(
      userId.toString()
    );

    res.status(200).json({ success: true, conversations });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getMessages = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).user._id;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 30;

    const result = await messagingService.getMessages({
      conversationId,
      userId: userId.toString(),
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const { text, image } = req.body;
    const userId = (req as any).user._id;

    const message = await messagingService.sendMessage({
      conversationId,
      senderId: userId.toString(),
      text,
      image,
    });

    res.status(201).json({ success: true, message });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const markAsRead = async (req: Request, res: Response) => {
  try {
    const { conversationId } = req.params;
    const userId = (req as any).user._id;

    const result = await messagingService.markAsRead({
      conversationId,
      userId: userId.toString(),
    });

    res.status(200).json({ success: true, ...result });
  } catch (error: any) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  markAsRead,
};
