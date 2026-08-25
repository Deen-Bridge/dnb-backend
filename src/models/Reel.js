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
    // Duet / stitch linkage. A derivative reel is a response video linked to an
    // original reel. `originalReelId` is null for a normal (top-level) reel.
    originalReelId: {
      type: Schema.Types.ObjectId,
      ref: "Reel",
      default: null,
    },
    // `duet` = response shown side-by-side with the original.
    // `stitch` = play a portion of the original, then the user's response.
    duetType: {
      type: String,
      enum: ["duet", "stitch"],
      default: null,
    },
    // For a stitch, the [start, end] portion (in seconds) of the original that
    // is prepended before the response video plays.
    stitchClip: {
      start: { type: Number, min: 0 },
      end: { type: Number, min: 0 },
    },
    // Compositing descriptor produced by utils/videoCompositor.js. Records the
    // compositing intent/metadata; actual frame compositing is delegated to the
    // media pipeline.
    composition: { type: Schema.Types.Mixed, default: null },
    // Derivative counts surfaced on the original reel.
    duetCount: { type: Number, default: 0 },
    stitchCount: { type: Number, default: 0 },
    likes: [{ type: Schema.Types.ObjectId, ref: "User" }],
    loves: [{ type: Schema.Types.ObjectId, ref: "User" }],
    comments: [commentSchema],
    shareCount: { type: Number, default: 0 },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: true }
);

reelSchema.index({ createdAt: -1 });
reelSchema.index({ description: "text" });
// Browse all duets/stitches for a given reel, newest first.
reelSchema.index({ originalReelId: 1, createdAt: -1 });

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