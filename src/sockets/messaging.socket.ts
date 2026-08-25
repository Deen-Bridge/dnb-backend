import { Server, Socket } from "socket.io";
import messagingService from "../services/messaging.service.ts";
import logger from "../config/logger.js";

export const initMessagingSocket = (io: Server) => {
  const messagingNamespace = io.of("/messaging");

  messagingNamespace.on("connection", (socket: Socket) => {
    logger.info(`Socket connected to /messaging: ${socket.id}`);

    socket.on("join_conversation", (conversationId: string) => {
      const room = `dm_${conversationId}`;
      socket.join(room);
      logger.info(`Socket ${socket.id} joined room ${room}`);
    });

    socket.on("leave_conversation", (conversationId: string) => {
      const room = `dm_${conversationId}`;
      socket.leave(room);
      logger.info(`Socket ${socket.id} left room ${room}`);
    });

    socket.on(
      "send_message",
      async (data: {
        conversationId: string;
        senderId: string;
        text?: string;
        image?: string;
      }) => {
        try {
          const message = await messagingService.sendMessage(data);
          const room = `dm_${data.conversationId}`;
          messagingNamespace.to(room).emit("new_message", message);
        } catch (error: any) {
          socket.emit("message_error", { message: error.message });
        }
      }
    );

    socket.on(
      "typing",
      (data: { conversationId: string; userId: string; isTyping: boolean }) => {
        const room = `dm_${data.conversationId}`;
        socket.to(room).emit("user_typing", data);
      }
    );

    socket.on(
      "mark_read",
      async (data: { conversationId: string; userId: string }) => {
        try {
          await messagingService.markAsRead({
            conversationId: data.conversationId,
            userId: data.userId,
          });
          const room = `dm_${data.conversationId}`;
          messagingNamespace.to(room).emit("messages_read", {
            conversationId: data.conversationId,
            userId: data.userId,
          });
        } catch (error: any) {
          socket.emit("message_error", { message: error.message });
        }
      }
    );

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /messaging: ${socket.id}`);
    });
  });

  return messagingNamespace;
};

export default initMessagingSocket;
