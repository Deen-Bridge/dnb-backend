import logger from "../config/logger.js";

/**
 * Reading-progress real-time sync.
 *
 * Follows the same convention as space-poll.socket.js: a dedicated namespace
 * with per-user rooms. When a socket.io server is attached (see
 * initReadingProgressSocket), progress updates written through the service are
 * pushed to every other device the same user has connected, so reading
 * position stays in sync in real time.
 *
 * If no socket.io server is wired in, emitProgress() is a safe no-op and the
 * REST endpoints + the `version`/`updatedAt` fields on the library listing act
 * as a poll-based fallback. Importing this module has NO side effects.
 */

let ioRef = null;

const roomFor = (userId) => `reading_progress_${userId}`;

export const initReadingProgressSocket = (io) => {
  ioRef = io;
  const progressNamespace = io.of("/reading-progress");

  progressNamespace.on("connection", (socket) => {
    logger.info(`Socket connected to /reading-progress: ${socket.id}`);

    socket.on("join_reading_progress_room", (userId) => {
      const room = roomFor(userId);
      socket.join(room);
      logger.info(`Socket ${socket.id} joined room ${room}`);
    });

    socket.on("leave_reading_progress_room", (userId) => {
      const room = roomFor(userId);
      socket.leave(room);
      logger.info(`Socket ${socket.id} left room ${room}`);
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /reading-progress: ${socket.id}`);
    });
  });

  return progressNamespace;
};

/**
 * emitProgress — seam used by the service layer to push a progress update to a
 * user's other devices. No-op (returns false) until a socket.io server is
 * attached via initReadingProgressSocket, so it is safe to call unconditionally
 * and never throws during CI / health-check boots.
 */
export const emitProgress = (userId, progress) => {
  if (!ioRef || !userId) return false;
  try {
    ioRef
      .of("/reading-progress")
      .to(roomFor(userId))
      .emit("reading_progress_updated", progress);
    return true;
  } catch (error) {
    logger.error("Failed to emit reading progress update:", error);
    return false;
  }
};

export default initReadingProgressSocket;
