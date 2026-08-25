import mongoose from "mongoose";

const badgeSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    icon: {
      type: String,
    },
    category: {
      type: String,
      default: "milestone",
    },
    criteriaType: {
      type: String,
      required: true,
      enum: ["courses_completed", "category_completed", "custom"],
    },
    threshold: {
      type: Number,
      default: 1,
    },
  },
  { timestamps: true }
);

export default mongoose.model("Badge", badgeSchema);
