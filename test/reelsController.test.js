import { jest } from "@jest/globals";
import mongoose from "mongoose";
import { validationResult } from "express-validator";

const ID = () => new mongoose.Types.ObjectId().toString();

const Reel = {
  find: jest.fn(),
  findById: jest.fn(),
  findOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
  updateOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
};
const ReelComment = {
  create: jest.fn(), find: jest.fn(), findById: jest.fn(), findOne: jest.fn(),
  updateOne: jest.fn(), countDocuments: jest.fn(),
};
const ReelEngagement = { create: jest.fn() };
const uploadStream = jest.fn();
const createReelDerivative = jest.fn();
const listReelDerivatives = jest.fn();
const moderationFlagReel = jest.fn();

jest.unstable_mockModule("../src/models/Reel.js", () => ({ default: Reel }));
jest.unstable_mockModule("../src/models/ReelComment.js", () => ({ default: ReelComment }));
jest.unstable_mockModule("../src/models/ReelEngagement.js", () => ({ default: ReelEngagement }));
jest.unstable_mockModule("../src/utils/cloudinary.js", () => ({
  default: { uploader: { upload_stream: uploadStream } },
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() },
}));
jest.unstable_mockModule("../src/services/reelDuetService.js", () => ({
  createReelDerivative,
  listReelDerivatives,
}));
jest.unstable_mockModule("../src/services/moderation.service.js", () => ({
  default: { flagReel: moderationFlagReel },
}));

const controller = await import("../src/controllers/reelController.js");
const { flagReel } = await import("../src/controllers/moderation.controller.js");
const validators = await import("../src/validators/reelValidators.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

// find().sort().skip().limit().populate().lean() chain
const listChain = (result) => {
  const chain = {};
  ["sort", "skip", "limit", "populate"].forEach((m) => {
    chain[m] = jest.fn().mockReturnValue(chain);
  });
  chain.lean = jest.fn().mockResolvedValue(result);
  return chain;
};

const arrayLike = (items) => {
  const arr = [...items];
  arr.id = (id) => arr.find((c) => c._id.toString() === id) || null;
  return arr;
};

beforeEach(() => {
  jest.clearAllMocks();
  uploadStream.mockImplementation((_opts, cb) => ({
    end: () =>
      cb(null, {
        secure_url: "https://cdn/v.mp4",
        public_id: "dnb/reels/v",
        duration: 12,
      }),
  }));
});

describe("reel create", () => {
  const user = { _id: ID() };

  it("uploads to Cloudinary and creates a reel", async () => {
    const doc = {
      toObject: () => ({
        _id: "r1",
        description: "hi",
        video: "https://cdn/v.mp4",
        tags: ["a", "b"],
        createdBy: { _id: user._id, name: "N" },
      }),
    };
    doc.populate = jest.fn().mockResolvedValue(doc);
    Reel.create.mockResolvedValue(doc);
    const res = mockRes();
    await controller.createReel(
      { body: { description: "hi", tags: "a, b," }, user, file: { buffer: Buffer.from("x") } },
      res
    );
    expect(uploadStream).toHaveBeenCalledWith(
      expect.objectContaining({ resource_type: "video", folder: "dnb/reels" }),
      expect.any(Function)
    );
    expect(Reel.create).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ["a", "b"], videoPublicId: "dnb/reels/v", createdBy: user._id })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].reel.tags).toEqual(["a", "b"]);
  });

  it("rejects missing description and missing video", async () => {
    let res = mockRes();
    await controller.createReel({ body: {}, user, file: { buffer: Buffer.from("x") } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    res = mockRes();
    await controller.createReel({ body: { description: "d" }, user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(uploadStream).not.toHaveBeenCalled();
  });

  it("returns 500 when the Cloudinary upload fails", async () => {
    uploadStream.mockImplementation((_o, cb) => ({ end: () => cb(new Error("boom")) }));
    const res = mockRes();
    await controller.createReel(
      { body: { description: "d" }, user, file: { buffer: Buffer.from("x") } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(Reel.create).not.toHaveBeenCalled();
  });
});

describe("reel list / visibility / scheduling", () => {
  it("lists reels with pagination and viewer state", async () => {
    const viewer = ID();
    Reel.find.mockReturnValue(
      listChain([{ _id: "r1", description: "d", likes: [viewer], loves: [], comments: [1, 2] }])
    );
    Reel.countDocuments.mockResolvedValue(3);
    const res = mockRes();
    await controller.getReels({ query: { limit: "1", page: "1" }, user: { _id: viewer } }, res);
    const body = res.json.mock.calls[0][0];
    expect(res.status).toHaveBeenCalledWith(200);
    expect(body.hasMore).toBe(true);
    expect(body.reels[0].viewerState.liked).toBe(true);
    expect(body.reels[0].stats.comments).toBe(2);
  });

  it("clamps out-of-range page/limit and filters to visible active reels", async () => {
    const chain = listChain([]);
    Reel.find.mockReturnValue(chain);
    Reel.countDocuments.mockResolvedValue(0);
    const res = mockRes();
    await controller.getReels({ query: { limit: "999", page: "-4" }, user: { _id: ID() } }, res);
    expect(chain.limit).toHaveBeenCalledWith(50);
    expect(chain.skip).toHaveBeenCalledWith(0);
    expect(Reel.find).toHaveBeenCalledWith({ isRemoved: false, status: "active" });
  });

  it("getReelById returns 404 for unknown reel and 500 on DB error", async () => {
    const q = (v) => ({ populate: () => ({ lean: v }) });
    Reel.findOne.mockReturnValue(q(jest.fn().mockResolvedValue(null)));
    let res = mockRes();
    await controller.getReelById({ params: { id: ID() }, user: { _id: ID() } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    Reel.findOne.mockReturnValue(q(jest.fn().mockRejectedValue(new Error("db"))));
    res = mockRes();
    await controller.getReelById({ params: { id: ID() }, user: { _id: ID() } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("reactions", () => {
  const uid = ID();

  it("adds a like and removes an existing love", async () => {
    Reel.findOneAndUpdate.mockReturnValue({ lean: async () => ({ likes: [uid], loves: [] }) });
    const res = mockRes();
    await controller.reactToReel({ params: { id: ID() }, body: { type: "like" }, user: { _id: uid } }, res);
    expect(Reel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ _id: expect.any(String), isRemoved: false, status: "active" }),
      expect.any(Array), { new: true }
    );
    expect(res.json.mock.calls[0][0].viewerState).toEqual({ liked: true, loved: false });
  });

  it("toggles an existing like off", async () => {
    Reel.findOneAndUpdate.mockReturnValue({ lean: async () => ({ likes: [], loves: [] }) });
    const res = mockRes();
    await controller.reactToReel({ params: { id: ID() }, body: { type: "like" }, user: { _id: uid } }, res);
    expect(res.json.mock.calls[0][0].viewerState.liked).toBe(false);
  });

  it("rejects invalid type and unknown reel", async () => {
    let res = mockRes();
    await controller.reactToReel({ params: { id: ID() }, body: { type: "hate" }, user: { _id: uid } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    Reel.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    res = mockRes();
    await controller.reactToReel({ params: { id: ID() }, body: { type: "love" }, user: { _id: uid } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("comments", () => {
  const uid = ID();

  it("adds a trimmed comment to the separate comment collection", async () => {
    const reel = { _id: ID() };
    Reel.findOne.mockResolvedValue(reel);
    ReelComment.create.mockResolvedValue({ _id: ID() });
    Reel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    ReelComment.findById.mockReturnValue({ populate: () => ({ lean: async () => ({ text: "nice" }) }) });
    ReelComment.countDocuments.mockResolvedValue(1);
    const res = mockRes();
    await controller.addReelComment({ params: { id: reel._id }, body: { text: "  nice " }, user: { _id: uid } }, res);
    expect(ReelComment.create).toHaveBeenCalledWith({ reel: reel._id, user: uid, text: "nice" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].stats.comments).toBe(1);
  });

  it("rejects blank comment text", async () => {
    const res = mockRes();
    await controller.addReelComment({ params: { id: ID() }, body: { text: "   " }, user: { _id: uid } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(Reel.findById).not.toHaveBeenCalled();
  });

  it("returns comments newest first, paginated", async () => {
    const comments = [
      { _id: 1, createdAt: 1 },
      { _id: 2, createdAt: 3 },
      { _id: 3, createdAt: 2 },
    ];
    Reel.findOne.mockReturnValue({ select: () => ({ lean: async () => ({ _id: ID() }) }) });
    ReelComment.find.mockReturnValue(listChain(comments.slice(1).reverse()));
    ReelComment.countDocuments.mockResolvedValue(3);
    const res = mockRes();
    await controller.getReelComments({ params: { id: ID() }, query: { limit: "2" } }, res);
    const body = res.json.mock.calls[0][0];
    expect(body.comments.map((c) => c._id)).toEqual([3, 2]);
    expect(body.hasMore).toBe(true);
  });

  it("deletes own comment but forbids others", async () => {
    const commentId = ID();
    const owner = ID();
    Reel.findOne.mockResolvedValue({ createdBy: ID() });
    ReelComment.findOne.mockResolvedValue({ user: owner });
    ReelComment.updateOne.mockResolvedValue({ modifiedCount: 1 });
    Reel.updateOne.mockResolvedValue({ modifiedCount: 1 });
    ReelComment.countDocuments.mockResolvedValue(0);
    let res = mockRes();
    await controller.deleteReelComment({ params: { id: ID(), commentId }, user: { _id: owner } }, res);
    expect(ReelComment.updateOne).toHaveBeenCalledWith(
      { _id: commentId, reel: expect.any(String), status: "active" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "removed" }) })
    );
    expect(res.status).toHaveBeenCalledWith(200);

    Reel.findOne.mockResolvedValue({ createdBy: ID() });
    ReelComment.findOne.mockResolvedValue({ user: owner });
    res = mockRes();
    await controller.deleteReelComment({ params: { id: ID(), commentId }, user: { _id: ID() } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 404 for a missing comment", async () => {
    Reel.findOne.mockResolvedValue({ createdBy: ID() });
    ReelComment.findOne.mockResolvedValue(null);
    const res = mockRes();
    await controller.deleteReelComment({ params: { id: ID(), commentId: ID() }, user: { _id: ID() } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("share / view counters", () => {
  it("increments counters and 404s for unknown reels", async () => {
    const viewer = ID();
    ReelEngagement.create.mockResolvedValue({});
    Reel.findOneAndUpdate.mockReturnValue({ lean: async () => ({ shareCount: 4, viewCount: 9 }) });
    let res = mockRes();
    await controller.registerReelShare({ params: { id: ID() }, user: { _id: viewer } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, shareCount: 4 });
    res = mockRes();
    await controller.registerReelView({ params: { id: ID() }, user: { _id: viewer } }, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, viewCount: 9 });

    Reel.findOneAndUpdate.mockReturnValue({ lean: async () => null });
    res = mockRes();
    await controller.registerReelView({ params: { id: ID() }, user: { _id: viewer } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("report (flag) reel", () => {
  const user = { _id: ID() };

  it("flags a reel with a reason", async () => {
    moderationFlagReel.mockResolvedValue({ _id: "f1" });
    const reelId = ID();
    const res = mockRes();
    await flagReel({ params: { reelId }, body: { reason: "spam" }, user }, res);
    expect(moderationFlagReel).toHaveBeenCalledWith(
      expect.objectContaining({ reelId, reporterId: user._id, reason: "spam" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects a blank reason and surfaces service errors as 400", async () => {
    let res = mockRes();
    await flagReel({ params: { reelId: ID() }, body: { reason: " " }, user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(moderationFlagReel).not.toHaveBeenCalled();

    moderationFlagReel.mockRejectedValue(new Error("Reel not found"));
    res = mockRes();
    await flagReel({ params: { reelId: ID() }, body: { reason: "x" }, user }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].message).toBe("Reel not found");
  });
});

describe("duet / stitch controller", () => {
  it("creates a stitch with a clip and propagates service status codes", async () => {
    const doc = { toObject: () => ({ _id: "d1", createdBy: null }) };
    doc.populate = jest.fn().mockResolvedValue(doc);
    createReelDerivative.mockResolvedValue(doc);
    const req = {
      params: { id: ID() },
      body: { description: "d", type: "stitch", stitchStart: "1", stitchEnd: "4" },
      user: { _id: ID() },
      file: { buffer: Buffer.from("x") },
    };
    let res = mockRes();
    await controller.createReelDuet(req, res);
    expect(createReelDerivative).toHaveBeenCalledWith(
      expect.objectContaining({ clip: { start: 1, end: 4 } })
    );
    expect(res.status).toHaveBeenCalledWith(201);

    createReelDerivative.mockRejectedValue(Object.assign(new Error("gone"), { statusCode: 404 }));
    res = mockRes();
    await controller.createReelDuet(req, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("reelValidators", () => {
  const run = async (chain, req) => {
    const full = { body: {}, params: {}, query: {}, ...req };
    for (const v of chain) await v.run(full);
    return validationResult(full)
      .array({ onlyFirstError: true })
      .map((e) => e.path);
  };

  it("accepts a valid duet", async () => {
    const errs = await run(validators.createReelDuetValidation, {
      params: { id: ID() },
      body: { description: "hello", type: "duet" },
    });
    expect(errs).toEqual([]);
  });

  it("accepts a valid stitch", async () => {
    const errs = await run(validators.createReelDuetValidation, {
      params: { id: ID() },
      body: { description: "hello", type: "stitch", stitchStart: "1", stitchEnd: "5" },
    });
    expect(errs).toEqual([]);
  });

  it("rejects bad id, missing description and bad type", async () => {
    const errs = await run(validators.createReelDuetValidation, {
      params: { id: "nope" },
      body: { type: "remix" },
    });
    expect(errs).toEqual(expect.arrayContaining(["id", "description", "type"]));
  });

  it("rejects a stitch whose end is not after start, or is missing", async () => {
    let errs = await run(validators.createReelDuetValidation, {
      params: { id: ID() },
      body: { description: "d", type: "stitch", stitchStart: "5", stitchEnd: "3" },
    });
    expect(errs).toContain("stitchEnd");
    errs = await run(validators.createReelDuetValidation, {
      params: { id: ID() },
      body: { description: "d", type: "stitch", stitchStart: "1" },
    });
    expect(errs).toContain("stitchEnd");
  });

  it("validates list query params", async () => {
    expect(
      await run(validators.listReelDuetsValidation, {
        params: { id: ID() },
        query: { type: "duet", page: "2", limit: "10" },
      })
    ).toEqual([]);
    const errs = await run(validators.listReelDuetsValidation, {
      params: { id: ID() },
      query: { type: "x", page: "0", limit: "51" },
    });
    expect(errs).toEqual(expect.arrayContaining(["type", "page", "limit"]));
  });
});
