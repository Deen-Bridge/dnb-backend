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

const Book = mongoose.model("Book", bookSchema);

export default Book;
