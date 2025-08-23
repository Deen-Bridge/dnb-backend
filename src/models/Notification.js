import mongoose from "mongoose";

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    sender: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "follow", // Someone followed you
        "unfollow", // Someone unfollowed you
        "new_course", // New course from someone you follow
        "new_book", // New book from someone you follow
        "course_like", // Someone liked your course
        "book_like", // Someone liked your book
        "course_comment", // Someone commented on your course
        "book_comment", // Someone commented on your book
        "system", // System notification
        "welcome", // Welcome notification
        "recommendation", // New recommendation
      ],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      // Additional data for the notification
      courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Course",
      },
      bookId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Book",
      },
      spaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Space",
      },
      reelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Reel",
      },
      commentId: String,
      // Any other relevant data
    },
    isRead: {
      type: Boolean,
      default: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    priority: {
      type: String,
      enum: ["low", "medium", "high", "urgent"],
      default: "medium",
    },
  },
  {
    timestamps: true,
    // Index for efficient queries
    indexes: [
      { recipient: 1, createdAt: -1 },
      { recipient: 1, isRead: 1 },
      { recipient: 1, isDeleted: 1 },
    ],
  }
);

export default mongoose.model("Notification", notificationSchema);
