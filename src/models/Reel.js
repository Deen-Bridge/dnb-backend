// models/Reel.js
import mongoose from "mongoose";

const { Schema, Types, model } = mongoose;

const commentSchema = new Schema(
  {
    _id: { type: Schema.Types.ObjectId, auto: true },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    text: { type: String, required: true, trim: true, maxlength: 500 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const reelSchema = new Schema(
  {
    description: { type: String, required: true, trim: true, maxlength: 2000 },
    category: { type: String, trim: true },
    tags: [{ type: String, trim: true }],
    video: { type: String, required: true },
    videoPublicId: { type: String },
    thumbnail: { type: String },
    duration: { type: Number },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    loves: [{ type: Schema.Types.ObjectId, ref: "User" }],
    comments: [commentSchema],
    shareCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reelSchema.index({ createdAt: -1 });

reelSchema.virtual("likeCount").get(function () {
  return this.likes?.length || 0;
});

reelSchema.virtual("loveCount").get(function () {
  return this.loves?.length || 0;
});

reelSchema.virtual("commentCount").get(function () {
  return this.comments?.length || 0;
});

reelSchema.set("toJSON", { virtuals: true });
reelSchema.set("toObject", { virtuals: true });

export default model("Reel", reelSchema);