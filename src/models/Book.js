import mongoose from "mongoose";
import { getSupportedCodes } from "../config/assets.js";

const bookSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  author: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  category: String,
  categoryRef: { type: mongoose.Schema.Types.ObjectId, ref: "Category", index: true },
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
  readCount: {
    type: Number,
    default: 0,
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5,
  },
  numReviews: {
    type: Number,
    default: 0,
    min: 0,
  },
  ratingBreakdown: {
    1: { type: Number, default: 0 },
    2: { type: Number, default: 0 },
    3: { type: Number, default: 0 },
    4: { type: Number, default: 0 },
    5: { type: Number, default: 0 },
  },
  reviews: [
    {
      user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
      },
      comment: { type: String, required: true },
      rating: {
          type: Number,
          required: true,
          min: 1,
          max: 5,
          validate: { validator: Number.isInteger, message: "Rating must be an integer" },
        },
      createdAt: { type: Date, default: Date.now }
    }
  ],
  description: {
    type: String,
    required: true,
  },
  // Catalog moderation state. Books default to active; a take-down hides the
  // book from catalog and reading views while preserving it for admins, the
  // author, and purchasers whose licence still permits access.
  status: {
    type: String,
    enum: ["active", "taken-down"],
    default: "active",
    index: true,
  },
  statusBeforeTakedown: {
    type: String,
    enum: ["active", "taken-down"],
    default: "active",
  },
  takenDownReason: {
    type: String,
    enum: ["content-violation", "dmca", "quality-issues", "other"],
    default: null,
  },
  takenDownNote: {
    type: String,
    default: null,
    maxlength: 1000,
  },
  takenDownAt: {
    type: Date,
    default: null,
  },
  takenDownBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    default: null,
  },
  // Licensing switch: when false, even existing purchasers lose reading
  // access for the duration of the take-down.
  purchaserAccessAllowed: {
    type: Boolean,
    default: true,
  },
  image: {
    type: String,
    required: true,
  },
  fileUrl: {
    type: String,
  },
  filePublicId: {
    type: String,
  },
  // Audiobook support: URL + Cloudinary public id of the uploaded audio file
  // (MP3/M4A), plus its duration in seconds. `duration` feeds the player's
  // progress bar and lets the client derive a listening percentage from the
  // tracked position. `fileUrl` is optional so a book can ship as audio-only.
  audioFileUrl: {
    type: String,
    default: null,
  },
  audioFilePublicId: {
    type: String,
    default: null,
  },
  duration: {
    type: Number,
    default: 0,
    min: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

bookSchema.index({ title: "text", description: "text", category: "text" }, { weights: { title: 5 } });
bookSchema.index({ rating: -1 });
bookSchema.index({ author: 1 });
bookSchema.index({ category: 1 });
bookSchema.index({ status: 1, createdAt: -1 });
bookSchema.index({ createdAt: -1 });

const Book = mongoose.model("Book", bookSchema);

export default Book;
