import { Server } from "socket.io";
import logger from "../config/logger.js";

let ioRef = null;

const roomForUser = (userId) => `user_preferences_${userId}`;

export const initUserPreferencesSocket = (io) => {
  ioRef = io;
  const preferencesNamespace = io.of("/preferences");

  preferencesNamespace.on("connection", (socket) => {
    logger.info(`Socket connected to /preferences: ${socket.id}`);

    socket.on("join_preferences_room", (userId) => {
      if (!userId) return;
      socket.join(roomForUser(userId));
      logger.info(`Socket ${socket.id} joined preferences room ${roomForUser(userId)}`);
    });

    socket.on("leave_preferences_room", (userId) => {
      if (!userId) return;
      socket.leave(roomForUser(userId));
      logger.info(`Socket ${socket.id} left preferences room ${roomForUser(userId)}`);
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /preferences: ${socket.id}`);
    });
  });

  return preferencesNamespace;
};

export const emitPreferenceUpdate = (userId, preferences) => {
  if (!ioRef || !userId) return false;
  try {
    const room = roomForUser(userId);
    ioRef.of("/preferences").to(room).emit("preference_updated", {
      userId,
      preferences,
      timestamp: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    logger.error("Failed to emit preference update event:", error);
    return false;
  }
};

export default initUserPreferencesSocket;
