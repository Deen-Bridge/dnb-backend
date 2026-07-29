import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";

const courseSchema = new mongoose.Schema(
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
    video: {
      type: String, // video URL or playlist ID
    },
    price: {
      type: Number,
      default: 0,
    },
    // Asset the price is denominated in; existing rows default to USDC.
    currency: {
      type: String,
      default: "USDC",
      enum: getSupportedCodes(),
    },
    reviews: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        comment: { type: String, required: true },
        rating: { type: Number, required: true, min: 1, max: 5 },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    enrolledUsers: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    sections: [
      {
        title: String,
        order: Number,
        lessons: [
          {
            title: String,
            order: Number,
            videoUrl: String,
            durationSeconds: Number,
          },
        ],
      },
    ],
  },

  { timestamps: true }
);

courseSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });
export default mongoose.model("Course", courseSchema);
