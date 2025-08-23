import Notification from "../models/Notification.js";
import User from "../models/User.js";

// Store active SSE connections
const sseConnections = new Map();

// SSE endpoint for real-time notifications
export const sseNotifications = async (req, res) => {
  const userId = req.user._id.toString();
  
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Cache-Control'
  });
  // Send initial connection message
  res.write(`data: ${JSON.stringify({ type: 'connection', message: 'Connected to notifications' })}\n\n`);

  // Store connection
  sseConnections.set(userId, res);

  // Handle client disconnect
  req.on('close', () => {
    sseConnections.delete(userId);
    console.log(`SSE connection closed for user: ${userId}`);
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    if (sseConnections.has(userId)) {
      res.write(`data: ${JSON.stringify({ type: 'ping', timestamp: Date.now() })}\n\n`);
    } else {
      clearInterval(keepAlive);
    }
  }, 30000); // Send ping every 30 seconds
};

// Send notification to specific user (for real-time updates)
export const sendNotificationToUser = async (userId, notificationData) => {
  try {
    const notification = await Notification.create({
      recipient: userId,
      ...notificationData
    });

    // Populate sender info
    await notification.populate('sender', 'name avatar');

    // Send real-time notification via SSE
    const connection = sseConnections.get(userId.toString());
    if (connection) {
      connection.write(`data: ${JSON.stringify({
        type: 'new_notification', 
        notification: notification 
      })}\n\n`);
    }

    return notification;
  } catch (error) {
    console.error('Error sending notification:', error);
    throw error;
  }
};

// Create follow notification
export const createFollowNotification = async (followerId, followedId) => {
  const follower = await User.findById(followerId).select('name avatar');
  
  await sendNotificationToUser(followedId, {
    sender: followerId,
    type: 'follow',
    title: 'New Follower',
    message: `${follower.name} started following you`,
    priority: 'medium'
  });
};

// Create unfollow notification
export const createUnfollowNotification = async (unfollowerId, unfollowedId) => {
  const unfollower = await User.findById(unfollowerId).select('name avatar');
  
  await sendNotificationToUser(unfollowedId, {
    sender: unfollowerId,
    type: 'unfollow',
    title: 'User Unfollowed',
    message: `${unfollower.name} unfollowed you`,
    priority: 'low'
  });
};

// Create new course notification for followers
export const createNewCourseNotification = async (courseId, creatorId, courseTitle) => {
  const creator = await User.findById(creatorId);
  const followers = creator.followers;

  for (const followerId of followers) {
    await sendNotificationToUser(followerId, {
      sender: creatorId,
      type: 'new_course',
      title: 'New Course Available',
      message: `${creator.name} created a new course: ${courseTitle}`,
      data: { courseId },
      priority: 'medium'
    });
  }
};

// Create new book notification for followers
export const createNewBookNotification = async (bookId, authorId, bookTitle) => {
  const author = await User.findById(authorId);
  const followers = author.followers;

  for (const followerId of followers) {
    await sendNotificationToUser(followerId, {
      sender: authorId,
      type: 'new_book',
      title: 'New Book Available',
      message: `${author.name} published a new book: ${bookTitle}`,
      data: { bookId },
      priority: 'medium'
    });
  }
};

// Get user notifications
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;
    const { page = 1, limit = 20, unreadOnly = false } = req.query;

    const query = {
      recipient: userId,
      isDeleted: false
    };

    if (unreadOnly === 'true') {
      query.isRead = false;
    }

    const notifications = await Notification.find(query)
      .populate('sender', 'name avatar')
      .populate('data.courseId', 'title thumbnail')
      .populate('data.bookId', 'title image')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit)
      .lean();

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
      isDeleted: false
    });

    res.status(200).json({
      success: true,
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalNotifications: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      },
      unreadCount
    });

  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications',
      error: error.message
    });
  }
};

// Mark notification as read
export const markNotificationAsRead = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isRead: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      notification
    });

  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read',
      error: error.message
    });
  }
};

// Mark all notifications as read
export const markAllNotificationsAsRead = async (req, res) => {
  try {
    const userId = req.user._id;

    await Notification.updateMany(
      { recipient: userId, isRead: false, isDeleted: false },
      { $set: { isRead: true } }
    );

    res.status(200).json({
      success: true,
      message: 'All notifications marked as read'
    });

  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to mark notifications as read',
      error: error.message
    });
  }
};

// Delete notification
export const deleteNotification = async (req, res) => {
  try {
    const { notificationId } = req.params;
    const userId = req.user._id;

    const notification = await Notification.findOneAndUpdate(
      { _id: notificationId, recipient: userId },
      { isDeleted: true },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Notification deleted'
    });

  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete notification',
      error: error.message
    });
  }
};

// Get notification settings (for future use)
export const getNotificationSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select('notificationSettings');

    res.status(200).json({
      success: true,
      settings: user.notificationSettings || {
        follow: true,
        newContent: true,
        likes: true,
        comments: true,
        system: true
      }
    });

  } catch (error) {
    console.error('Get notification settings error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch notification settings',
      error: error.message
    });
  }
}; 