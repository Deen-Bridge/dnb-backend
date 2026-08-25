import Conversation from "../models/conversation.model.ts";
import Message from "../models/message.model.ts";

export class MessagingService {
  async getOrCreateConversation(userId1: string, userId2: string) {
    const sorted = [userId1, userId2].sort();

    let conversation = await Conversation.findOne({
      participants: { $all: sorted, $size: 2 },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: sorted,
      });
    }

    return conversation.populate("participants", "name email avatar");
  }

  async sendMessage({
    conversationId,
    senderId,
    text,
    image,
  }: {
    conversationId: string;
    senderId: string;
    text?: string;
    image?: string;
  }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    if (!conversation.participants.some((p: any) => p.toString() === senderId)) {
      throw new Error("You are not a participant in this conversation");
    }

    const message = await Message.create({
      conversation: conversationId,
      sender: senderId,
      text: text || "",
      image: image || undefined,
      readBy: [senderId],
    });

    conversation.lastMessage = message._id as any;
    conversation.lastMessageAt = new Date();
    await conversation.save();

    return message.populate([
      { path: "sender", select: "name email avatar" },
      { path: "readBy", select: "name email avatar" },
    ]);
  }

  async getConversations(userId: string) {
    const conversations = await Conversation.find({
      participants: userId,
    })
      .populate("participants", "name email avatar")
      .populate("lastMessage")
      .sort({ lastMessageAt: -1 });

    return conversations;
  }

  async getMessages({
    conversationId,
    userId,
    page = 1,
    limit = 30,
  }: {
    conversationId: string;
    userId: string;
    page?: number;
    limit?: number;
  }) {
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      throw new Error("Conversation not found");
    }

    if (!conversation.participants.some((p: any) => p.toString() === userId)) {
      throw new Error("You are not a participant in this conversation");
    }

    const skip = (page - 1) * limit;
    const messages = await Message.find({ conversation: conversationId })
      .populate("sender", "name email avatar")
      .populate("readBy", "name email avatar")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await Message.countDocuments({ conversation: conversationId });

    return {
      messages,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async markAsRead({
    conversationId,
    userId,
  }: {
    conversationId: string;
    userId: string;
  }) {
    await Message.updateMany(
      {
        conversation: conversationId,
        readBy: { $ne: userId },
      },
      { $addToSet: { readBy: userId } }
    );

    return { success: true };
  }
}

export const messagingService = new MessagingService();
export default messagingService;
