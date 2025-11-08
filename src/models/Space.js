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
      enum: ["live", "upcoming", "ended"],
      default: "upcoming",
    },
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

export default mongoose.model("Space", spaceSchema);
