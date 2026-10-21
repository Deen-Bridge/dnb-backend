import mongoose from "mongoose";

const noteSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    book: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Book",
      required: true,
      index: true,
    },
    highlight: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Highlight",
      index: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    pageNumber: {
      type: Number,
    },
    passage: {
      type: String,
    },
  },
  { timestamps: true }
);

noteSchema.index({ user: 1, book: 1 });
noteSchema.index({ content: "text", passage: "text" });

export default mongoose.model("Note", noteSchema);
