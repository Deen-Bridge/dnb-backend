// mongo/seeds/index.js
//
// Seed the database with sample users, courses, books and spaces for local
// development and testing.
//
// Usage:
//   node mongo/seeds/index.js              # minimal dataset
//   node mongo/seeds/index.js --minimal    # minimal dataset (default)
//   node mongo/seeds/index.js --full       # comprehensive dataset
//   node mongo/seeds/index.js --reset      # wipe collections, then seed (minimal)
//   node mongo/seeds/index.js --clean      # wipe collections only (cleanup)
//
// Requires MONGO_URI in the environment (or .env). Run via npm:
//   npm run db:seed          npm run db:seed:full
//   npm run db:seed:reset    npm run db:seed:clean

import mongoose from "mongoose";
import dotenv from "dotenv";

import User from "../../src/models/User.js";
import Course from "../../src/models/Course.js";
import Book from "../../src/models/Book.js";
import Space from "../../src/models/Space.js";

import { seedUsers } from "./users.js";
import { seedCourses } from "./courses.js";
import { seedBooks } from "./books.js";
import { seedSpaces } from "./spaces.js";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
if (!MONGO_URI) {
  console.error("MONGO_URI is required (set it in .env or the environment)");
  process.exit(1);
}

const args = process.argv.slice(2);
const full = args.includes("--full");
const cleanOnly = args.includes("--clean");
const reset = args.includes("--reset");
const mode = full ? "full" : "minimal";

const COLLECTIONS = [
  { name: "users", model: User },
  { name: "courses", model: Course },
  { name: "books", model: Book },
  { name: "spaces", model: Space },
];

const run = async () => {
  await mongoose.connect(MONGO_URI);
  console.log(`Connected to MongoDB (${mongoose.connection.name})`);

  if (reset || cleanOnly) {
    console.log("Cleaning existing seed collections...");
    for (const { name, model } of COLLECTIONS) {
      const { deletedCount } = await model.deleteMany({});
      console.log(`  cleared ${name}: removed ${deletedCount}`);
    }
  }

  if (cleanOnly) {
    console.log("Database cleaned. Nothing seeded.");
    await mongoose.disconnect();
    return;
  }

  console.log(`Seeding ${mode} dataset...`);

  const users = await seedUsers({ User, full });
  // Content is owned by a verified educator (or the admin when none exists).
  const contentOwner =
    users.find((u) => u.role === "mentor" && u.verifiedEducator) ||
    users.find((u) => u.role === "admin") ||
    users[0];

  const courses = await seedCourses({ Course, full, createdBy: contentOwner._id });
  const books = await seedBooks({ Book, full, author: contentOwner._id });
  const spaces = await seedSpaces({ Space, full, host: contentOwner._id });

  console.log("Seed summary:");
  console.log(`  users:   ${users.length}`);
  console.log(`  courses: ${courses.length}`);
  console.log(`  books:   ${books.length}`);
  console.log(`  spaces:  ${spaces.length}`);
  console.log("Done.");
  console.log("Seeded accounts use the password: DeenBridge#2024");

  await mongoose.disconnect();
};

run().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
