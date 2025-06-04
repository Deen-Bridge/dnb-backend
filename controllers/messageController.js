import Message from "../models/Message.js";
import Conversation from "../models/Conversation.js";

export const getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;

    // Verify the conversation exists and user is a participant
    const conversation = await Conversation.findById(conversationId);
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Get all messages for this conversation
    const messages = await Message.find({
      conversationId: conversationId,
    })
      .sort({ createdAt: 1 }) // Sort by creation time ascending
      .populate("sender", "name avatar");

    res.json(messages);
  } catch (err) {
    console.error("Error fetching messages:", err);
    res.status(500).json({ error: err.message });
  }
};

export const createMessage = async (req, res) => {
  try {
    const { conversationId, text } = req.body;
    const sender = req.user._id; // Get the sender from the authenticated user
    const message = await new Message({ conversationId, sender, text }).save();
    const populated = await message.populate("sender", "name avatar");
    res.status(201).json(populated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const createConversation = async (req, res) => {
  const { userId1, userId2 } = req.body;

  if (!userId1 || !userId2) {
    return res
      .status(400)
      .json({ error: "Both userId1 and userId2 are required" });
  }

  try {
    let conversation = await Conversation.findOne({
      participants: { $all: [userId1, userId2] },
    });

    if (!conversation) {
      conversation = await Conversation.create({
        participants: [userId1, userId2],
      });
    }

    return res.status(200).json({ conversationId: conversation._id });
  } catch (error) {
    console.error("Error creating conversation:", error);
    return res.status(500).json({ error: "Internal Server Error" });
  }
};

export const getConversations = async (req, res) => {
  try {
    const userId = req.user._id;

    // Find all conversations where the user is a participant
    const conversations = await Conversation.find({
      participants: userId,
    }).populate({
      path: "participants",
      select: "name avatar email",
    });

    // Get the last message for each conversation
    const conversationsWithLastMessage = await Promise.all(
      conversations.map(async (conversation) => {
        const lastMessage = await Message.findOne({
          conversationId: conversation._id,
        })
          .sort({ createdAt: -1 })
          .populate("sender", "name avatar");

        return {
          ...conversation.toObject(),
          lastMessage,
        };
      })
    );

    res.json(conversationsWithLastMessage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
