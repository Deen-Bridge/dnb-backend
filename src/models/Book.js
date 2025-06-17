import mongoose from "mongoose";

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
  price: {
    type: Number,
    default: 0,
  },
  readCount: {
    type: Number,
    default: 0,
  },
  reviews: [
    {
      user: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: "User", 
        required: true 
      },
      comment: { type: String, required: true },
      rating: { type: Number, required: true, min: 1, max: 5 },
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
    required: true,
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

const Book = mongoose.model("Book", bookSchema);

export default Book;
