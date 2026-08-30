import { Server, Socket } from "socket.io";
import logger from "../config/logger.js";
import { IUserPreferences } from "../types/preferences.js";

let ioRef: Server | null = null;

const roomForUser = (userId: string) => `user_preferences_${userId}`;

export const initUserPreferencesSocket = (io: Server) => {
  ioRef = io;
  const preferencesNamespace = io.of("/preferences");

  preferencesNamespace.on("connection", (socket: Socket) => {
    logger.info(`Socket connected to /preferences: ${socket.id}`);

    socket.on("join_preferences_room", (userId: string) => {
      if (!userId) return;
      const room = roomForUser(userId);
      socket.join(room);
      logger.info(`Socket ${socket.id} joined preferences room ${room}`);
    });

    socket.on("leave_preferences_room", (userId: string) => {
      if (!userId) return;
      const room = roomForUser(userId);
      socket.leave(room);
      logger.info(`Socket ${socket.id} left preferences room ${room}`);
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /preferences: ${socket.id}`);
    });
  });

  return preferencesNamespace;
};

export const emitPreferenceUpdate = (userId: string, preferences: Partial<IUserPreferences>) => {
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
