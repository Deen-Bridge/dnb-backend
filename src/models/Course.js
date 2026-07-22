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
    categoryRef: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
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

courseSchema.pre('save', async function(next) {
  if (this.isModified('categoryRef') && this.categoryRef) {
    const category = await mongoose.model('Category').findById(this.categoryRef).select('name').lean();
    if (category) {
      this.category = category.name;
    }
  }
  next();
});

export default mongoose.model("Course", courseSchema);
