import ReadingGroup from "../models/reading-group.model.js";
import ReadingGroupMember from "../models/reading-group-member.model.js";
import Book from "../models/Book.js";
import Notification from "../models/Notification.js";

export class ReadingGroupService {
  async createGroup({
    name,
    description,
    bookId,
    creatorId,
    privacy = "public",
    chaptersPerWeek = 1,
    readingSchedule = [],
  }) {
    const book = await Book.findById(bookId);
    if (!book) {
      throw new Error("Book not found");
    }

    const group = await ReadingGroup.create({
      name,
      description,
      book: bookId,
      creator: creatorId,
      privacy,
      chaptersPerWeek,
      readingSchedule,
    });

    await ReadingGroupMember.create({
      group: group._id,
      user: creatorId,
      role: "admin",
      status: "active",
    });

    return group;
  }

  async getGroups({
    bookId,
    privacy,
    search,
    page = 1,
    limit = 20,
  }) {
    const query = {};
    if (bookId) query.book = bookId;
    if (privacy) query.privacy = privacy;
    if (search && search.trim() !== "") {
      const regex = new RegExp(search, "i");
      query.$or = [{ name: regex }, { description: regex }];
    }

    const skip = (page - 1) * limit;
    const [groups, total] = await Promise.all([
      ReadingGroup.find(query)
        .populate("book", "title author thumbnail")
        .populate("creator", "name email avatar")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ReadingGroup.countDocuments(query),
    ]);

    return {
      groups,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getGroupDetails(groupId, userId) {
    const group = await ReadingGroup.findById(groupId)
      .populate("book", "title author thumbnail totalPages chapters")
      .populate("creator", "name email avatar");

    if (!group) {
      throw new Error("Reading group not found");
    }

    const membersCount = await ReadingGroupMember.countDocuments({ group: group._id, status: "active" });

    let userMembership = null;
    if (userId) {
      userMembership = await ReadingGroupMember.findOne({ group: group._id, user: userId });
    }

    return {
      group,
      membersCount,
      userMembership,
    };
  }

  async joinGroup(groupId, userId) {
    const group = await ReadingGroup.findById(groupId);
    if (!group) {
      throw new Error("Reading group not found");
    }

    const status = group.privacy === "private" ? "pending" : "active";

    const membership = await ReadingGroupMember.findOneAndUpdate(
      { group: groupId, user: userId },
      {
        role: "member",
        status,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return membership;
  }

  async inviteMember(groupId, adminId, targetUserId) {
    const group = await ReadingGroup.findById(groupId);
    if (!group) {
      throw new Error("Reading group not found");
    }

    const adminMember = await ReadingGroupMember.findOne({ group: groupId, user: adminId, role: "admin" });
    const isCreator = group.creator.toString() === adminId.toString();

    if (!adminMember && !isCreator) {
      throw new Error("Only group admins can invite members");
    }

    const membership = await ReadingGroupMember.findOneAndUpdate(
      { group: groupId, user: targetUserId },
      {
        role: "member",
        status: "invited",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await Notification.create({
      recipient: targetUserId,
      sender: adminId,
      type: "system",
      title: "Reading Group Invitation",
      message: `You have been invited to join the reading group "${group.name}".`,
      data: { bookId: group.book },
      priority: "medium",
    }).catch(() => {});

    return membership;
  }

  async updateSchedule(
    groupId,
    adminId,
    readingSchedule,
    chaptersPerWeek
  ) {
    const group = await ReadingGroup.findById(groupId);
    if (!group) {
      throw new Error("Reading group not found");
    }

    const adminMember = await ReadingGroupMember.findOne({ group: groupId, user: adminId, role: "admin" });
    const isCreator = group.creator.toString() === adminId.toString();

    if (!adminMember && !isCreator) {
      throw new Error("Only group admins can update the reading schedule");
    }

    if (readingSchedule) {
      group.readingSchedule = readingSchedule;
    }
    if (chaptersPerWeek !== undefined) {
      group.chaptersPerWeek = chaptersPerWeek;
    }

    await group.save();
    return group;
  }

  async addDiscussionPost({
    groupId,
    chapter,
    userId,
    content,
  }) {
    const group = await ReadingGroup.findById(groupId);
    if (!group) {
      throw new Error("Reading group not found");
    }

    const member = await ReadingGroupMember.findOne({ group: groupId, user: userId, status: "active" });
    if (!member) {
      throw new Error("You must be an active member of this group to post discussions");
    }

    const post = {
      chapter,
      user: userId,
      content,
      createdAt: new Date(),
    };

    group.discussions.push(post);
    await group.save();

    return group.discussions;
  }

  async getDiscussions(groupId, chapter) {
    const group = await ReadingGroup.findById(groupId).populate("discussions.user", "name email avatar");
    if (!group) {
      throw new Error("Reading group not found");
    }

    let discussions = group.discussions;
    if (chapter !== undefined && !isNaN(chapter)) {
      discussions = discussions.filter((d) => d.chapter === Number(chapter));
    }

    return discussions;
  }

  async updateMemberProgress({
    groupId,
    userId,
    currentChapter,
    currentProgressPercent,
  }) {
    const member = await ReadingGroupMember.findOne({ group: groupId, user: userId });
    if (!member) {
      throw new Error("Member not found in reading group");
    }

    if (currentChapter !== undefined) member.currentChapter = currentChapter;
    if (currentProgressPercent !== undefined) member.currentProgressPercent = currentProgressPercent;
    member.lastReadDate = new Date();

    await member.save();
    return member;
  }

  async getMemberProgressDashboard(groupId) {
    const group = await ReadingGroup.findById(groupId).populate("book", "title totalPages");
    if (!group) {
      throw new Error("Reading group not found");
    }

    const members = await ReadingGroupMember.find({ group: groupId, status: "active" })
      .populate("user", "name email avatar")
      .sort({ currentProgressPercent: -1, currentChapter: -1 });

    const totalMembers = members.length;
    const avgProgress =
      totalMembers > 0
        ? Number((members.reduce((sum, m) => sum + m.currentProgressPercent, 0) / totalMembers).toFixed(1))
        : 0;

    return {
      group: {
        _id: group._id,
        name: group.name,
        book: group.book,
        chaptersPerWeek: group.chaptersPerWeek,
      },
      stats: {
        totalMembers,
        avgProgressPercent: avgProgress,
      },
      membersProgress: members,
    };
  }
}

export const readingGroupService = new ReadingGroupService();
export default readingGroupService;
