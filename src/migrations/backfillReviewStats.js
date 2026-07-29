import dotenv from "dotenv";
import mongoose from "mongoose";
import Course from "../models/Course.js";
import Book from "../models/Book.js";
import { computeReviewStats } from "../utils/reviewStats.js";

dotenv.config();

const statsDiffer = (document, stats) =>
  document.rating !== stats.rating ||
  document.numReviews !== stats.numReviews ||
  [1, 2, 3, 4, 5].some((star) => (document.ratingBreakdown?.[star] ?? 0) !== stats.ratingBreakdown[star]);

const backfillModel = async (Model) => {
  let updated = 0;
  const cursor = Model.find().cursor();

  for await (const document of cursor) {
    const stats = computeReviewStats(document.reviews);
    if (!statsDiffer(document, stats)) continue;

    await Model.updateOne({ _id: document._id }, { $set: stats });
    updated += 1;
  }

  return updated;
};

if (!process.env.MONGO_URI) {
  throw new Error("MONGO_URI must be set to backfill review statistics");
}

try {
  await mongoose.connect(process.env.MONGO_URI);
  const [courses, books] = await Promise.all([backfillModel(Course), backfillModel(Book)]);
  console.log(`Backfilled review statistics for ${courses} courses and ${books} books.`);
} finally {
  await mongoose.disconnect();
}
