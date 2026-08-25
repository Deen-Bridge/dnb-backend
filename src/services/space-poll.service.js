import SpacePoll from "../models/space-poll.model.js";
import PollVote from "../models/poll-vote.model.js";
import Space from "../models/Space.js";

export class SpacePollService {
  async createPoll({ spaceId, hostId, question, options }) {
    const space = await Space.findById(spaceId);
    if (!space) {
      throw new Error("Space not found");
    }

    const isHost = space.host.toString() === hostId.toString();
    if (!isHost) {
      throw new Error("Only the host can create polls for this space");
    }

    if (!options || !Array.isArray(options) || options.length < 2) {
      throw new Error("At least two options are required to create a poll");
    }

    const formattedOptions = options.map((opt, index) => {
      if (typeof opt === "string") {
        return { optionIndex: index, text: opt };
      }
      return { optionIndex: index, text: opt.text };
    });

    const poll = await SpacePoll.create({
      space: spaceId,
      creator: hostId,
      question,
      options: formattedOptions,
      status: "active",
    });

    return this.getPollResults(poll._id.toString());
  }

  async voteInPoll({ pollId, userId, optionIndex }) {
    const poll = await SpacePoll.findById(pollId);
    if (!poll) {
      throw new Error("Poll not found");
    }

    if (poll.status !== "active") {
      throw new Error("Poll is closed for voting");
    }

    const validOption = poll.options.some((o) => o.optionIndex === optionIndex);
    if (!validOption) {
      throw new Error("Invalid option selected");
    }

    await PollVote.findOneAndUpdate(
      { poll: poll._id, user: userId },
      { space: poll.space, optionIndex },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return this.getPollResults(poll._id.toString(), userId);
  }

  async getPollResults(pollId, userId) {
    const poll = await SpacePoll.findById(pollId).populate("creator", "name email avatar");
    if (!poll) {
      throw new Error("Poll not found");
    }

    const votes = await PollVote.find({ poll: poll._id });
    const totalVotes = votes.length;

    const voteCounts = {};
    poll.options.forEach((o) => {
      voteCounts[o.optionIndex] = 0;
    });

    votes.forEach((v) => {
      if (voteCounts[v.optionIndex] !== undefined) {
        voteCounts[v.optionIndex] += 1;
      }
    });

    const results = poll.options.map((o) => {
      const count = voteCounts[o.optionIndex] || 0;
      const percentage = totalVotes > 0 ? Number(((count / totalVotes) * 100).toFixed(1)) : 0;
      return {
        optionIndex: o.optionIndex,
        text: o.text,
        votes: count,
        percentage,
      };
    });

    let userVote = null;
    if (userId) {
      const existingVote = votes.find((v) => v.user.toString() === userId.toString());
      if (existingVote) {
        userVote = existingVote.optionIndex;
      }
    }

    return {
      _id: poll._id,
      space: poll.space,
      creator: poll.creator,
      question: poll.question,
      status: poll.status,
      closedAt: poll.closedAt,
      createdAt: poll.createdAt,
      updatedAt: poll.updatedAt,
      totalVotes,
      results,
      userVote,
    };
  }

  async getSpacePolls(spaceId, userId) {
    const polls = await SpacePoll.find({ space: spaceId }).sort({ createdAt: -1 });
    const pollResults = await Promise.all(
      polls.map((poll) => this.getPollResults(poll._id.toString(), userId))
    );
    return pollResults;
  }

  async closePoll({ pollId, hostId }) {
    const poll = await SpacePoll.findById(pollId);
    if (!poll) {
      throw new Error("Poll not found");
    }

    const space = await Space.findById(poll.space);
    const isHost = space && space.host.toString() === hostId.toString();
    const isCreator = poll.creator.toString() === hostId.toString();

    if (!isHost && !isCreator) {
      throw new Error("Only the space host or poll creator can close this poll");
    }

    poll.status = "closed";
    poll.closedAt = new Date();
    await poll.save();

    return this.getPollResults(poll._id.toString());
  }

  async exportPollResults(pollId) {
    const pollData = await this.getPollResults(pollId);
    const votes = await PollVote.find({ poll: pollId }).populate("user", "name email");

    const csvHeader = "Option Index,Option Text,Votes,Percentage\n";
    const csvRows = pollData.results
      .map((r) => `"${r.optionIndex}","${r.text.replace(/"/g, '""')}",${r.votes},${r.percentage}%`)
      .join("\n");

    const exportSummary = {
      pollId: pollData._id,
      spaceId: pollData.space,
      question: pollData.question,
      status: pollData.status,
      totalVotes: pollData.totalVotes,
      createdAt: pollData.createdAt,
      closedAt: pollData.closedAt,
      results: pollData.results,
      votes: votes.map((v) => ({
        user: v.user,
        optionIndex: v.optionIndex,
        votedAt: v.createdAt,
      })),
      csvData: csvHeader + csvRows,
    };

    return exportSummary;
  }
}

export const spacePollService = new SpacePollService();
export default spacePollService;
