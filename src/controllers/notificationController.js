import Notification from "../models/Notification.js";
import logger from "../config/logger.js";
import User from "../models/User.js";
import { getRedisClient, isRedisReady } from "../config/redis.js";

/**
 * SSE Connections Map
 * Maps userId (string) -> Set of active Express Response streams.
 * Allows multiple concurrent browser tabs/sessions per user and proper auth-scoped cleanup on disconnect.
 */
const sseConnections = new Map();

/**
 * Multi-Instance SSE Delivery via Redis Pub/Sub:
 * When horizontally scaled (e.g. on Render), an instance producing a notification
 * publishes the event to the Redis channel 'notifications:sse'. All backend instances
 * listen on this channel and deliver the payload to any locally connected client SSE stream.
 * If Redis is unavailable, the system falls back seamlessly to in-memory local delivery.
 */
let isSubscriberInit = false;
export const initRedisSubscriber = async () => {
  if (isSubscriberInit) return;
  if (!isRedisReady()) return;

  try {
    const mainClient = getRedisClient();
    if (!mainClient) return;

    const subClient = mainClient.duplicate();
    await subClient.connect();

    await subClient.subscribe("notifications:sse", (message) => {
      try {
        const { recipientId, notification } = JSON.parse(message);
        deliverLocalSSENotification(recipientId, notification);
      } catch (err) {
        logger.error("Error handling Redis SSE pub/sub message:", err);
      }
    });

    isSubscriberInit = true;
    logger.info("✅ Redis SSE Pub/Sub subscriber initialized");
  } catch (err) {
    logger.error("Failed to initialize Redis SSE subscriber:", err);
  }
};

/**
 * Deliver SSE payload to active local connections for a given user
 */
export const deliverLocalSSENotification = (recipientId, notification) => {
  const userConns = sseConnections.get(recipientId.toString());
  if (userConns && userConns.size > 0) {
    const payload = `data: ${JSON.stringify({
      type: "new_notification",
      notification,
    })}\n\n`;

    userConns.forEach((res) => {
      try {
        res.write(payload);
      } catch (err) {
        logger.error(`Error writing SSE payload to user ${recipientId}:`, err);
      }
    });
  }
};

/**
 * Dispatch SSE notification across multi-instance deployment via Redis or local Map
 */
export const dispatchSSENotification = async (recipientId, notification) => {
  if (isRedisReady()) {
    try {
      await initRedisSubscriber();
      const client = getRedisClient();
      if (client) {
        await client.publish(
          "notifications:sse",
          JSON.stringify({ recipientId: recipientId.toString(), notification })
        );
        return;
      }
    } catch (err) {
      logger.error("Error publishing SSE notification to Redis:", err);
    }
  }

  // Fallback to local delivery if Redis is not active or fails
  deliverLocalSSENotification(recipientId, notification);
};

// SSE endpoint for real-time notifications
export const sseNotifications = async (req, res) => {
  const userId = req.user._id.toString();

  // Set SSE headers
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Cache-Control",
  });

  // Send initial connection message
  res.write(
    `data: ${JSON.stringify({
      type: "connection",
      message: "Connected to notifications",
    })}\n\n`
  );

  // Store connection in user's connection set
  if (!sseConnections.has(userId)) {
    sseConnections.set(userId, new Set());
  }
  const userConns = sseConnections.get(userId);
  userConns.add(res);

  // Initialize Redis subscriber if available
  initRedisSubscriber().catch((err) =>
    logger.error("Redis subscriber init error:", err)
  );

  // Handle client disconnect
  req.on("close", () => {
    const conns = sseConnections.get(userId);
    if (conns) {
      conns.delete(res);
      if (conns.size === 0) {
        sseConnections.delete(userId);
      }
    }
    logger.info(`SSE connection closed for user: ${userId}`);
  });

  // Keep connection alive
  const keepAlive = setInterval(() => {
    const conns = sseConnections.get(userId);
    if (conns && conns.has(res)) {
      res.write(
        `data: ${JSON.stringify({ type: "ping", timestamp: Date.now() })}\n\n`
      );
    } else {
      clearInterval(keepAlive);
    }
  }, 30000);
};

// Send notification to specific user (for real-time updates)
export const sendNotificationToUser = async (userId, notificationData) => {
  try {
    const notification = await Notification.create({
      recipient: userId,
      ...notificationData,
    });

    // Populate sender info
    await notification.populate("sender", "name avatar");

    // Dispatch via SSE
    await dispatchSSENotification(userId, notification);

    return notification;
  } catch (error) {
    logger.error("Error sending notification:", error);
    throw error;
  }
};

// Create follow notification
export const createFollowNotification = async (followerId, followedId) => {
  const follower = await User.findById(followerId).select("name avatar");
  if (!follower) return;

  return sendNotificationToUser(followedId, {
    sender: followerId,
    type: "follow",
    title: "New Follower",
    message: `${follower.name} started following you`,
    priority: "medium",
  });
};

// Create unfollow notification
export const createUnfollowNotification = async (unfollowerId, unfollowedId) => {
  const unfollower = await User.findById(unfollowerId).select("name avatar");
  if (!unfollower) return;

  return sendNotificationToUser(unfollowedId, {
    sender: unfollowerId,
    type: "unfollow",
    title: "User Unfollowed",
    message: `${unfollower.name} unfollowed you`,
    priority: "low",
  });
};

// Create new course notification for followers (batched fan-out)
export const createNewCourseNotification = async (courseId, creatorId, courseTitle) => {
  try {
    const creator = await User.findById(creatorId).select("name avatar followers");
    if (!creator || !creator.followers || creator.followers.length === 0) return [];

    const docs = creator.followers.map((followerId) => ({
      recipient: followerId,
      sender: creatorId,
      type: "new_course",
      title: "New Course Available",
      message: `${creator.name} created a new course: ${courseTitle}`,
      data: { courseId },
      priority: "medium",
    }));

    // Batched DB insert in one write operation
    const createdNotifications = await Notification.insertMany(docs);

    // Broadcast SSE notifications with pre-populated sender info
    const senderPayload = { _id: creatorId, name: creator.name, avatar: creator.avatar };
    for (const notification of createdNotifications) {
      const plainNotif = notification.toObject ? notification.toObject() : { ...notification };
      plainNotif.sender = senderPayload;
      dispatchSSENotification(plainNotif.recipient, plainNotif);
    }

    return createdNotifications;
  } catch (error) {
    logger.error("Error creating new course notifications:", error);
    throw error;
  }
};

// Create new book notification for followers (batched fan-out)
export const createNewBookNotification = async (bookId, authorId, bookTitle) => {
  try {
    const author = await User.findById(authorId).select("name avatar followers");
    if (!author || !author.followers || author.followers.length === 0) return [];

    const docs = author.followers.map((followerId) => ({
      recipient: followerId,
      sender: authorId,
      type: "new_book",
      title: "New Book Available",
      message: `${author.name} published a new book: ${bookTitle}`,
      data: { bookId },
      priority: "medium",
    }));

    // Batched DB insert in one write operation
    const createdNotifications = await Notification.insertMany(docs);

    // Broadcast SSE notifications with pre-populated author info
    const senderPayload = { _id: authorId, name: author.name, avatar: author.avatar };
    for (const notification of createdNotifications) {
      const plainNotif = notification.toObject ? notification.toObject() : { ...notification };
      plainNotif.sender = senderPayload;
      dispatchSSENotification(plainNotif.recipient, plainNotif);
    }

    return createdNotifications;
  } catch (error) {
    logger.error("Error creating new book notifications:", error);
    throw error;
  }
};

// Get user notifications (bounded pagination)
export const getUserNotifications = async (req, res) => {
  try {
    const userId = req.user._id;

    let page = parseInt(req.query.page, 10);
    if (isNaN(page) || page < 1) page = 1;

    let limit = parseInt(req.query.limit, 10);
    if (isNaN(limit) || limit < 1) limit = 20;
    if (limit > 100) limit = 100; // Enforce pagination cap of 100

    const unreadOnly = req.query.unreadOnly === "true";

    const query = {
      recipient: userId,
      isDeleted: false,
    };

    if (unreadOnly) {
      query.isRead = false;
    }

    const skip = (page - 1) * limit;

    const notifications = await Notification.find(query)
      .populate("sender", "name avatar")
      .populate("data.courseId", "title thumbnail")
      .populate("data.bookId", "title image")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean();

    const total = await Notification.countDocuments(query);
    const unreadCount = await Notification.countDocuments({
      recipient: userId,
      isRead: false,
      isDeleted: false,
    });

    res.status(200).json({
      success: true,
      notifications,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(total / limit) || 1,
        totalNotifications: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1,
      },
      unreadCount,
    });
  } catch (error) {
    logger.error("Get notifications error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
      error: error.message,
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
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      notification,
    });
  } catch (error) {
    logger.error("Mark notification read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notification as read",
      error: error.message,
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
      message: "All notifications marked as read",
    });
  } catch (error) {
    logger.error("Mark all notifications read error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to mark notifications as read",
      error: error.message,
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
        message: "Notification not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Notification deleted",
    });
  } catch (error) {
    logger.error("Delete notification error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to delete notification",
      error: error.message,
    });
  }
};

// Get notification settings (for future use)
export const getNotificationSettings = async (req, res) => {
  try {
    const userId = req.user._id;
    const user = await User.findById(userId).select("notificationSettings");

    res.status(200).json({
      success: true,
      settings: user?.notificationSettings || {
        follow: true,
        newContent: true,
        likes: true,
        comments: true,
        system: true,
      },
    });
  } catch (error) {
    logger.error("Get notification settings error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch notification settings",
      error: error.message,
    });
  }
};