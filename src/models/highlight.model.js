import mongoose from "mongoose";

const highlightSchema = new mongoose.Schema(
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
    text: {
      type: String,
      required: true,
      trim: true,
    },
    color: {
      type: String,
      enum: ["yellow", "blue", "green", "pink", "purple", "orange"],
      default: "yellow",
    },
    pageNumber: {
      type: Number,
    },
    passage: {
      type: String,
    },
    cfiRange: {
      type: String,
    },
  },
  { timestamps: true }
);

highlightSchema.index({ user: 1, book: 1 });
highlightSchema.index({ text: "text", passage: "text" });

export default mongoose.model("Highlight", highlightSchema);
