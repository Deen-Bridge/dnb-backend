import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Reel from "../src/models/Reel.js";
import User from "../src/models/User.js";
import {
  createReelDerivative,
  listReelDerivatives,
} from "../src/services/reelDuetService.js";

describe("Reel duet/stitch service", () => {
  let mongoServer;
  let author;
  let original;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (process.env.MONGO_URI) {
      try {
        await mongoose.connect(`${process.env.MONGO_URI}_reelduet`, {
          serverSelectionTimeoutMS: 2000,
        });
        return;
      } catch (_err) {}
    }
    mongoServer = await MongoMemoryServer.create();
    await mongoose.connect(mongoServer.getUri());
  }, 60000);

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    if (mongoServer) {
      await mongoServer.stop();
    }
  });

  beforeEach(async () => {
    await Reel.deleteMany({});
    await User.deleteMany({});

    author = await User.create({
      name: "Reel Author",
      email: "reel_author@example.com",
      password: "Qx7#vLmp92Zt",
      role: "student",
    });

    original = await Reel.create({
      description: "Original reel",
      video: "https://cdn.example.com/original.mp4",
      duration: 30,
      createdBy: author._id,
    });
  });

  test("creating a duet links it to the original and increments duetCount", async () => {
    const derivative = await createReelDerivative({
      originalReelId: original._id,
      type: "duet",
      userId: author._id,
      description: "My duet response",
      video: "https://cdn.example.com/duet-response.mp4",
      duration: 30,
    });

    expect(String(derivative.originalReelId)).toBe(String(original._id));
    expect(derivative.duetType).toBe("duet");
    expect(derivative.composition.layout).toBe("side-by-side");
    expect(derivative.composition.status).toBe("pending");
    expect(derivative.composition.sources.original.reelId).toBe(
      String(original._id)
    );

    const refreshed = await Reel.findById(original._id).lean();
    expect(refreshed.duetCount).toBe(1);
    expect(refreshed.stitchCount).toBe(0);
  });

  test("creating a stitch stores the clip range and increments stitchCount", async () => {
    const derivative = await createReelDerivative({
      originalReelId: original._id,
      type: "stitch",
      userId: author._id,
      description: "My stitch response",
      video: "https://cdn.example.com/stitch-response.mp4",
      duration: 20,
      clip: { start: 2, end: 7 },
    });

    expect(derivative.duetType).toBe("stitch");
    expect(derivative.stitchClip.start).toBe(2);
    expect(derivative.stitchClip.end).toBe(7);
    expect(derivative.composition.layout).toBe("prepend-clip");
    expect(derivative.composition.clip).toEqual({ start: 2, end: 7 });

    const refreshed = await Reel.findById(original._id).lean();
    expect(refreshed.stitchCount).toBe(1);
    expect(refreshed.duetCount).toBe(0);
  });

  test("a stitch without a valid clip range is rejected", async () => {
    await expect(
      createReelDerivative({
        originalReelId: original._id,
        type: "stitch",
        userId: author._id,
        description: "Bad stitch",
        video: "https://cdn.example.com/bad-stitch.mp4",
        clip: { start: 5, end: 5 },
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test("creating a derivative for a missing original throws 404", async () => {
    await expect(
      createReelDerivative({
        originalReelId: new mongoose.Types.ObjectId(),
        type: "duet",
        userId: author._id,
        description: "Orphan duet",
        video: "https://cdn.example.com/orphan.mp4",
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test("listing returns derivatives for a reel and supports type filtering", async () => {
    await createReelDerivative({
      originalReelId: original._id,
      type: "duet",
      userId: author._id,
      description: "Duet A",
      video: "https://cdn.example.com/a.mp4",
    });
    await createReelDerivative({
      originalReelId: original._id,
      type: "stitch",
      userId: author._id,
      description: "Stitch B",
      video: "https://cdn.example.com/b.mp4",
      clip: { start: 1, end: 4 },
    });

    const all = await listReelDerivatives(original._id, {});
    expect(all.total).toBe(2);
    expect(all.items).toHaveLength(2);
    all.items.forEach((item) => {
      expect(String(item.originalReelId)).toBe(String(original._id));
    });

    const onlyStitches = await listReelDerivatives(original._id, {
      type: "stitch",
    });
    expect(onlyStitches.total).toBe(1);
    expect(onlyStitches.items[0].duetType).toBe("stitch");
  });
});
