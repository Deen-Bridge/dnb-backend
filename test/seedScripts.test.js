import { execFile } from "child_process";
import { promisify } from "util";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

import User from "../src/models/User.js";
import Course from "../src/models/Course.js";
import Book from "../src/models/Book.js";
import Space from "../src/models/Space.js";
import { bookDatasets } from "../mongo/seeds/books.js";

const execFileAsync = promisify(execFile);
const seedScript = "mongo/seeds/index.js";

const runSeed = async (uri, ...args) => {
  const { stdout, stderr } = await execFileAsync(process.execPath, [seedScript, ...args], {
    env: { ...process.env, MONGO_URI: uri },
    cwd: process.cwd(),
  });
  return { stdout, stderr };
};

describe("Database seed scripts (#202)", () => {
  let mongoServer;
  let uri;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    mongoServer = await MongoMemoryServer.create();
    uri = mongoServer.getUri();
    await mongoose.connect(uri);
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  afterEach(async () => {
    // Leave a clean slate for the next scenario (the --clean flag is tested
    // explicitly, so wipe here only as a safety net between scenarios).
    await Promise.all([
      User.deleteMany({}),
      Course.deleteMany({}),
      Book.deleteMany({}),
      Space.deleteMany({}),
    ]);
  });

  const counts = async () => ({
    users: await User.countDocuments(),
    courses: await Course.countDocuments(),
    books: await Book.countDocuments(),
    spaces: await Space.countDocuments(),
  });

  it("seeds the minimal dataset via npm run db:seed", async () => {
    const { stdout } = await runSeed(uri, "--minimal");

    expect(stdout).toMatch(/Seeding minimal dataset/);
    expect(stdout).toMatch(/Done/);

    const c = await counts();
    expect(c.users).toBe(3);
    expect(c.courses).toBe(3);
    expect(c.books).toBe(3);
    expect(c.spaces).toBe(3);
  });

  it("seeds the comprehensive dataset with --full --reset", async () => {
    const { stdout } = await runSeed(uri, "--full", "--reset");

    expect(stdout).toMatch(/Seeding full dataset/);

    const c = await counts();
    expect(c.users).toBe(10);
    expect(c.courses).toBe(10);
    expect(c.books).toBe(10);
    expect(c.spaces).toBe(10);
  });

  it("hashes seeded user passwords", async () => {
    await runSeed(uri, "--minimal");

    const admin = await User.findOne({ email: "admin@deenbridge.dev" });
    expect(admin).not.toBeNull();
    expect(admin.password).not.toBe("DeenBridge#2024");
  });

  it("wires content to a seeded verified educator", async () => {
    await runSeed(uri, "--minimal");

    const instructor = await User.findOne({ email: "instructor@deenbridge.dev" });
    const course = await Course.findOne({});
    const book = await Book.findOne({});
    const space = await Space.findOne({});

    expect(course.createdBy.toString()).toBe(instructor._id.toString());
    expect(book.author.toString()).toBe(instructor._id.toString());
    expect(space.host.toString()).toBe(instructor._id.toString());
  });

  it("includes audiobook fields on seeded books", () => {
    // Asserted against the dataset (not the DB) because the audio fields only
    // persist once the audiobook model change lands; the seed data itself must
    // carry them so the player flow works out of the box.
    const fortress = bookDatasets.minimal.find(
      (b) => b.title === "Fortress of the Muslim"
    );
    expect(fortress.audioFileUrl).toMatch(/\.mp3$/);
    expect(fortress.duration).toBeGreaterThan(0);
  });

  it("cleans the database with --clean (npm run db:seed:clean)", async () => {
    await runSeed(uri, "--minimal");
    expect((await counts()).users).toBe(3);

    const { stdout } = await runSeed(uri, "--clean");
    expect(stdout).toMatch(/Database cleaned/);

    const c = await counts();
    expect(c.users).toBe(0);
    expect(c.courses).toBe(0);
    expect(c.books).toBe(0);
    expect(c.spaces).toBe(0);
  });
});
