import mongoose from "mongoose";

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
    // Guest speakers (array of user references or objects)
    speakers: [
      {
        name: { type: String, required: true },
        image: { type: String },
        bio: { type: String },
        userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      },
    ],
    price: {
      type: Number,
      default: 0, // 0 means free, any other value means paid
    },
    status: {
      type: String,
      enum: ["live", "upcoming", "ended"],
      default: "upcoming",
    },
    startTime: {
      type: Date,
      required: true,
    },
    duration: {
      type: Number, // in minutes
      required: true,
    },
    enrolledUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true }
);

export default mongoose.model("Space", spaceSchema);
