import SpacePoll from "../models/space-poll.model.ts";
import PollVote from "../models/poll-vote.model.ts";
import Space from "../models/Space.js";

export class SpacePollService {
  /**
   * Create a new poll in a space session.
   */
  async createPoll({ spaceId, hostId, question, options }: {
    spaceId: string;
    hostId: string;
    question: string;
    options: string[] | { optionIndex?: number; text: string }[];
  }) {
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

  /**
   * Vote in a poll during a space session.
   */
  async voteInPoll({ pollId, userId, optionIndex }: {
    pollId: string;
    userId: string;
    optionIndex: number;
  }) {
    const poll = await SpacePoll.findById(pollId);
    if (!poll) {
      throw new Error("Poll not found");
    }

    if (poll.status !== "active") {
      throw new Error("Poll is closed for voting");
    }

    const validOption = poll.options.some((o: any) => o.optionIndex === optionIndex);
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

  /**
   * Get live poll results with counts and percentages.
   */
  async getPollResults(pollId: string, userId?: string) {
    const poll = await SpacePoll.findById(pollId).populate("creator", "name email avatar");
    if (!poll) {
      throw new Error("Poll not found");
    }

    const votes = await PollVote.find({ poll: poll._id });
    const totalVotes = votes.length;

    const voteCounts: Record<number, number> = {};
    poll.options.forEach((o: any) => {
      voteCounts[o.optionIndex] = 0;
    });

    votes.forEach((v: any) => {
      if (voteCounts[v.optionIndex] !== undefined) {
        voteCounts[v.optionIndex] += 1;
      }
    });

    const results = poll.options.map((o: any) => {
      const count = voteCounts[o.optionIndex] || 0;
      const percentage = totalVotes > 0 ? Number(((count / totalVotes) * 100).toFixed(1)) : 0;
      return {
        optionIndex: o.optionIndex,
        text: o.text,
        votes: count,
        percentage,
      };
    });

    let userVote: number | null = null;
    if (userId) {
      const existingVote = votes.find((v: any) => v.user.toString() === userId.toString());
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
      createdAt: (poll as any).createdAt,
      updatedAt: (poll as any).updatedAt,
      totalVotes,
      results,
      userVote,
    };
  }

  /**
   * Get all polls for a space session with live vote results.
   */
  async getSpacePolls(spaceId: string, userId?: string) {
    const polls = await SpacePoll.find({ space: spaceId }).sort({ createdAt: -1 });
    const pollResults = await Promise.all(
      polls.map((poll) => this.getPollResults(poll._id.toString(), userId))
    );
    return pollResults;
  }

  /**
   * Close a poll to stop accepting new votes.
   */
  async closePoll({ pollId, hostId }: { pollId: string; hostId: string }) {
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

  /**
   * Export poll results in JSON / text / CSV friendly structure.
   */
  async exportPollResults(pollId: string) {
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
      votes: votes.map((v: any) => ({
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
