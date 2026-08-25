import readingGroupService from "../services/reading-group.service.js";

export const createGroup = async (req, res) => {
  try {
    const { name, description, bookId, privacy, chaptersPerWeek, readingSchedule } = req.body;
    const creatorId = req.user._id;

    if (!name || name.trim() === "") {
      return res.status(400).json({ success: false, message: "Group name is required" });
    }
    if (!bookId) {
      return res.status(400).json({ success: false, message: "bookId is required" });
    }

    const group = await readingGroupService.createGroup({
      name,
      description,
      bookId,
      creatorId,
      privacy,
      chaptersPerWeek,
      readingSchedule,
    });

    res.status(201).json({ success: true, group });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getGroups = async (req, res) => {
  try {
    const bookId = req.query.bookId;
    const privacy = req.query.privacy;
    const search = req.query.search || req.query.q;
    const page = parseInt(req.query.page, 10) || 1;
    const limit = parseInt(req.query.limit, 10) || 20;

    const result = await readingGroupService.getGroups({
      bookId,
      privacy,
      search,
      page,
      limit,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getGroupDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?._id;

    const details = await readingGroupService.getGroupDetails(id, userId);
    res.status(200).json({ success: true, ...details });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const joinGroup = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    const membership = await readingGroupService.joinGroup(id, userId);
    res.status(200).json({ success: true, membership });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const inviteMember = async (req, res) => {
  try {
    const { id } = req.params;
    const { targetUserId } = req.body;
    const adminId = req.user._id;

    if (!targetUserId) {
      return res.status(400).json({ success: false, message: "targetUserId is required" });
    }

    const membership = await readingGroupService.inviteMember(id, adminId, targetUserId);
    res.status(200).json({ success: true, membership, message: "Invitation sent" });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateSchedule = async (req, res) => {
  try {
    const { id } = req.params;
    const { readingSchedule, chaptersPerWeek } = req.body;
    const adminId = req.user._id;

    const group = await readingGroupService.updateSchedule(id, adminId, readingSchedule, chaptersPerWeek);
    res.status(200).json({ success: true, group });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const addDiscussionPost = async (req, res) => {
  try {
    const { id } = req.params;
    const { chapter, content } = req.body;
    const userId = req.user._id;

    if (chapter === undefined || chapter === null) {
      return res.status(400).json({ success: false, message: "Chapter is required" });
    }
    if (!content || content.trim() === "") {
      return res.status(400).json({ success: false, message: "Content is required" });
    }

    const discussions = await readingGroupService.addDiscussionPost({
      groupId: id,
      chapter: Number(chapter),
      userId,
      content,
    });

    res.status(201).json({ success: true, discussions });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getDiscussions = async (req, res) => {
  try {
    const { id } = req.params;
    const chapter = req.query.chapter ? parseInt(req.query.chapter, 10) : undefined;

    const discussions = await readingGroupService.getDiscussions(id, chapter);
    res.status(200).json({ success: true, discussions });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateMemberProgress = async (req, res) => {
  try {
    const { id } = req.params;
    const { currentChapter, currentProgressPercent } = req.body;
    const userId = req.user._id;

    const member = await readingGroupService.updateMemberProgress({
      groupId: id,
      userId,
      currentChapter,
      currentProgressPercent,
    });

    res.status(200).json({ success: true, member });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getMemberProgressDashboard = async (req, res) => {
  try {
    const { id } = req.params;

    const dashboard = await readingGroupService.getMemberProgressDashboard(id);
    res.status(200).json({ success: true, ...dashboard });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export default {
  createGroup,
  getGroups,
  getGroupDetails,
  joinGroup,
  inviteMember,
  updateSchedule,
  addDiscussionPost,
  getDiscussions,
  updateMemberProgress,
  getMemberProgressDashboard,
};
