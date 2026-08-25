import spacePollService from "../services/space-poll.service.js";
import logger from "../config/logger.js";

export const initSpacePollSocket = (io) => {
  const pollNamespace = io.of("/space-polls");

  pollNamespace.on("connection", (socket) => {
    logger.info(`Socket connected to /space-polls: ${socket.id}`);

    socket.on("join_space_poll_room", (spaceId) => {
      const room = `space_poll_${spaceId}`;
      socket.join(room);
      logger.info(`Socket ${socket.id} joined room ${room}`);
    });

    socket.on("leave_space_poll_room", (spaceId) => {
      const room = `space_poll_${spaceId}`;
      socket.leave(room);
      logger.info(`Socket ${socket.id} left room ${room}`);
    });

    socket.on("create_poll", async (data) => {
      try {
        const poll = await spacePollService.createPoll(data);
        const room = `space_poll_${data.spaceId}`;
        pollNamespace.to(room).emit("poll_created", poll);
      } catch (error) {
        socket.emit("poll_error", { message: error.message });
      }
    });

    socket.on("cast_vote", async (data) => {
      try {
        const updatedPoll = await spacePollService.voteInPoll(data);
        const room = `space_poll_${updatedPoll.space}`;
        pollNamespace.to(room).emit("poll_results_updated", updatedPoll);
      } catch (error) {
        socket.emit("poll_error", { message: error.message });
      }
    });

    socket.on("close_poll", async (data) => {
      try {
        const closedPoll = await spacePollService.closePoll(data);
        const room = `space_poll_${closedPoll.space}`;
        pollNamespace.to(room).emit("poll_closed", closedPoll);
      } catch (error) {
        socket.emit("poll_error", { message: error.message });
      }
    });

    socket.on("disconnect", () => {
      logger.info(`Socket disconnected from /space-polls: ${socket.id}`);
    });
  });

  return pollNamespace;
};

export default initSpacePollSocket;
