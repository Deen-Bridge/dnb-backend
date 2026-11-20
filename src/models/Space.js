import mongoose from "mongoose";
import { buildMeetingUrl } from "../utils/jitsi.js";

const spaceSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    thumbnail: {
      type: String, // image URL
    },
    // Host of the space (user who created it)
    host: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: {
      type: Number,
      default: 0, // 0 means free, any other value means paid
    },
    status: {
      type: String,
      enum: ["live", "upcoming", "ended", "cancelled"],
      default: "upcoming",
    },
    lifecycleHistory: [{
      status: { type: String, enum: ["live", "upcoming", "ended", "cancelled"] },
      changedAt: { type: Date, default: Date.now },
      changedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    }],
    eventDate: {
      type: Date,
      required: true,
    },
    eventTime: {
      type: String, // e.g., "14:00" or "18:30"
      required: true,
    },
    waitList: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    duration: {
      type: Number, // in minutes
      required: true,
    },
    capacity: {
      type: Number,
      min: 1,
    },
    enrolledUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    meetingRoom: {
      type: String,
      required: true,
      unique: true,
    },
    meetingUrl: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

spaceSchema.pre("validate", function (next) {
  const domain = process.env.JITSI_MEET_DOMAIN || "meet.jit.si";
  const waitList = this.waitList || [];
  const enrolledUsers = this.enrolledUsers || [];
  const waitListIds = waitList.map((id) => id.toString());
  const enrolledIds = enrolledUsers.map((id) => id.toString());

  if (new Set(waitListIds).size !== waitListIds.length) {
    return next(new Error("Space waitList cannot contain duplicate users"));
  }

  if (new Set(enrolledIds).size !== enrolledIds.length) {
    return next(new Error("Space enrolledUsers cannot contain duplicate users"));
  }

  if (enrolledIds.some((id) => waitListIds.includes(id))) {
    return next(new Error("A user cannot be both enrolled and waitlisted"));
  }

  if (this.capacity !== null && this.capacity !== undefined && enrolledIds.length > this.capacity) {
    return next(new Error("Space enrollment cannot exceed capacity"));
  }

  if (!this.meetingRoom) {
    const suffix = Math.random().toString(36).slice(2, 8);
    this.meetingRoom = `deenbridge-space-${this._id
      .toString()
      .slice(-6)}-${suffix}`;
  }

  if (!this.meetingUrl) {
    this.meetingUrl = buildMeetingUrl(domain, this.meetingRoom);
  }

  next();
});

spaceSchema.index({ title: "text", description: "text", category: "text" });
spaceSchema.index({ host: 1 });
spaceSchema.index({ status: 1, eventDate: 1 });

export default mongoose.model("Space", spaceSchema);
