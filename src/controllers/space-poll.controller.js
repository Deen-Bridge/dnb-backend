import spacePollService from "../services/space-poll.service.js";

export const createPoll = async (req, res) => {
  try {
    const { spaceId } = req.params;
    const { question, options } = req.body;
    const hostId = req.user._id;

    const poll = await spacePollService.createPoll({
      spaceId,
      hostId,
      question,
      options,
    });

    res.status(201).json({ success: true, poll });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getSpacePolls = async (req, res) => {
  try {
    const { spaceId } = req.params;
    const userId = req.user?._id;

    const polls = await spacePollService.getSpacePolls(spaceId, userId);
    res.status(200).json({ success: true, polls });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getPollResults = async (req, res) => {
  try {
    const { pollId } = req.params;
    const userId = req.user?._id;

    const poll = await spacePollService.getPollResults(pollId, userId);
    res.status(200).json({ success: true, poll });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const voteInPoll = async (req, res) => {
  try {
    const { pollId } = req.params;
    const { optionIndex } = req.body;
    const userId = req.user._id;

    if (optionIndex === undefined || optionIndex === null) {
      return res.status(400).json({ success: false, message: "optionIndex is required" });
    }

    const updatedPoll = await spacePollService.voteInPoll({
      pollId,
      userId,
      optionIndex: Number(optionIndex),
    });

    res.status(200).json({ success: true, poll: updatedPoll });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const closePoll = async (req, res) => {
  try {
    const { pollId } = req.params;
    const hostId = req.user._id;

    const closedPoll = await spacePollService.closePoll({
      pollId,
      hostId,
    });

    res.status(200).json({ success: true, poll: closedPoll });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const exportPollResults = async (req, res) => {
  try {
    const { pollId } = req.params;
    const format = req.query.format;

    const exportData = await spacePollService.exportPollResults(pollId);

    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="poll-${pollId}-results.csv"`);
      return res.status(200).send(exportData.csvData);
    }

    res.status(200).json({ success: true, export: exportData });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  createPoll,
  getSpacePolls,
  getPollResults,
  voteInPoll,
  closePoll,
  exportPollResults,
};
