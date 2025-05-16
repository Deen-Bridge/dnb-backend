import mongoose from "mongoose";

const reelSchema = new mongoose.Schema(
  {
    description: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    comment: {
      type: String,
    },
    video: {
        type: String,
        required: true
    },
    likes: {
      type: Number,
    },
    loves: {
      type: Number,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
  },

  { timestamps: true }
);

export default mongoose.model("Reel", reelSchema);
