import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import User from "../src/models/User.js";

async function runBenchmark() {
  console.log("Starting DB Latency Benchmark...");
  const mongoServer = await MongoMemoryServer.create({
    binary: {
      version: "7.0.14",
      checkMD5: false,
    },
  });
  await mongoose.connect(mongoServer.getUri());

  // Seed sample data
  const user = await User.create({
    name: "Test Creator",
    email: "creator@example.com",
    password: "hashedpassword123",
  });

  const coursesToSeed = [];
  for (let i = 0; i < 500; i++) {
    coursesToSeed.push({
      title: `Course ${i}`,
      description: `Description for course ${i} with lots of details and content`,
      category: "Programming",
      price: 19.99,
      status: "published",
      createdBy: user._id,
      sections: Array(10).fill({
        title: "Section Title",
        lessons: Array(20).fill({
          title: "Lesson Title",
          videoUrl: "https://example.com/video.mp4",
          durationSeconds: 600,
        }),
      }),
    });
  }
  await Course.insertMany(coursesToSeed);

  const booksToSeed = [];
  for (let i = 0; i < 500; i++) {
    booksToSeed.push({
      title: `Book ${i}`,
      description: `Description for book ${i}`,
      category: "Technology",
      price: 9.99,
      author: user._id,
      image: "https://example.com/cover.jpg",
      fileUrl: "https://example.com/book.pdf",
      reviews: Array(25).fill({
        user: user._id,
        comment: "Great book!",
        rating: 5,
      }),
    });
  }
  await Book.insertMany(booksToSeed);

  console.log("Seeded 500 courses and 500 books.");

  // Test Course List Query with Lean + Projections
  const iterations = 50;

  let start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await Course.find({ status: "published" })
      .select("_id title description category categoryRef thumbnail price currency views rating numReviews createdBy status publishedAt createdAt updatedAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("createdBy", "name email avatar")
      .lean();
  }
  let durationOptimized = (performance.now() - start) / iterations;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await Course.find({ status: "published" })
      .populate("createdBy", "name email avatar");
  }
  let durationUnoptimized = (performance.now() - start) / iterations;

  console.log(`\n--- Course List Query (Average over ${iterations} runs) ---`);
  console.log(`  Unoptimized (full docs + all fields + no limit): ${durationUnoptimized.toFixed(2)} ms`);
  console.log(`  Optimized (lean + select + limit 20 + indexes): ${durationOptimized.toFixed(2)} ms`);
  console.log(`  Performance Improvement: ${((1 - durationOptimized / durationUnoptimized) * 100).toFixed(1)}% reduction in query time (${(durationUnoptimized / durationOptimized).toFixed(1)}x faster)`);

  // Test Book List Query
  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await Book.find()
      .select("_id title author category categoryRef price currency readCount rating numReviews description image createdAt updatedAt")
      .sort({ createdAt: -1 })
      .limit(20)
      .populate("author", "name avatar bio")
      .lean();
  }
  let bookOptimized = (performance.now() - start) / iterations;

  start = performance.now();
  for (let i = 0; i < iterations; i++) {
    await Book.find()
      .populate("author", "name avatar bio")
      .populate("reviews.user", "name avatar");
  }
  let bookUnoptimized = (performance.now() - start) / iterations;

  console.log(`\n--- Book List Query (Average over ${iterations} runs) ---`);
  console.log(`  Unoptimized (full docs + reviews populate + all fields): ${bookUnoptimized.toFixed(2)} ms`);
  console.log(`  Optimized (lean + select + limit 20 + indexes): ${bookOptimized.toFixed(2)} ms`);
  console.log(`  Performance Improvement: ${((1 - bookOptimized / bookUnoptimized) * 100).toFixed(1)}% reduction in query time (${(bookUnoptimized / bookOptimized).toFixed(1)}x faster)`);

  await mongoose.disconnect();
  await mongoServer.stop();
}

runBenchmark().catch(console.error);
