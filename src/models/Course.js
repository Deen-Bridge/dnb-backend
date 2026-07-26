import mongoose from "mongoose";

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
    sections: [
      {
        title: { type: String, trim: true },
        order: { type: Number, default: 0 },
        lessons: [
          {
            _id: { type: mongoose.Schema.Types.ObjectId, auto: true },
            title: { type: String, trim: true, required: true },
            order: { type: Number, default: 0 },
            videoUrl: { type: String },
            durationSeconds: { type: Number, default: 0 },
            isPreview: { type: Boolean, default: false },
            resources: [{ type: String }],
          },
        ],
      },
    ],
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
  },

  { timestamps: true }
);

courseSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });

export default mongoose.model("Course", courseSchema);
