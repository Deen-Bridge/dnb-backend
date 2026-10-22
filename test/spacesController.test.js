import { jest } from "@jest/globals";

const Space = {
  find: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  findByIdAndDelete: jest.fn(),
};
const upload_stream = jest.fn();
const startRecording = jest.fn();
const finaliseRecording = jest.fn();
const listRecordingsForSpace = jest.fn();
const getRecordingById = jest.fn();
const deleteRecording = jest.fn();

jest.unstable_mockModule("../src/models/Space.js", () => ({ default: Space }));
jest.unstable_mockModule("../src/utils/cloudinary.js", () => ({
  default: { uploader: { upload_stream } },
}));
jest.unstable_mockModule("../src/services/spaceRecordingService.js", () => ({
  startRecording,
  finaliseRecording,
  listRecordingsForSpace,
  getRecordingById,
  deleteRecording,
}));
jest.unstable_mockModule("../src/config/logger.js", () => ({
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

const spaces = await import("../src/controllers/spaceController.js");
const recordings = await import("../src/controllers/spaceRecordingController.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const populated = (value) => ({ populate: jest.fn().mockResolvedValue(value) });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("spaceController - lifecycle", () => {
  const user = { _id: "host1" };

  test("createSpace creates an upcoming space hosted by the user", async () => {
    const created = { _id: "s1", status: "upcoming" };
    Space.create.mockResolvedValue(created);
    const res = mockRes();

    await spaces.createSpace(
      { body: { title: "T", description: "D", category: "c", status: "live" }, user },
      res
    );

    expect(Space.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: "T", status: "upcoming", price: 0, host: "host1", thumbnail: "" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, space: created });
  });

  test("createSpace uploads the thumbnail to Cloudinary", async () => {
    upload_stream.mockImplementation((_opts, cb) => ({
      end: () => cb(null, { secure_url: "https://cdn/thumb.png" }),
    }));
    Space.create.mockResolvedValue({ _id: "s1" });
    const res = mockRes();

    await spaces.createSpace(
      { body: { title: "T" }, user, files: { thumbnail: [{ buffer: Buffer.from("x") }] } },
      res
    );

    expect(upload_stream).toHaveBeenCalledWith({ folder: "spaces/thumbnails" }, expect.any(Function));
    expect(Space.create).toHaveBeenCalledWith(
      expect.objectContaining({ thumbnail: "https://cdn/thumb.png" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  test("createSpace returns 500 when the upload or DB fails", async () => {
    Space.create.mockRejectedValue(new Error("db down"));
    const res = mockRes();

    await spaces.createSpace({ body: { title: "T" }, user }, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "db down" });
  });

  test("joinWaitList adds the user and saves", async () => {
    const space = { waitList: [], push: undefined, save: jest.fn().mockResolvedValue() };
    Space.findById.mockResolvedValue(space);
    const res = mockRes();

    await spaces.joinWaitList({ params: { id: "s1" }, user: { _id: "u1" } }, res);

    expect(space.waitList).toEqual(["u1"]);
    expect(space.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, message: "Joined waitlist" });
  });

  test("joinWaitList rejects duplicates with 400", async () => {
    const space = { waitList: ["u1"], save: jest.fn() };
    Space.findById.mockResolvedValue(space);
    const res = mockRes();

    await spaces.joinWaitList({ params: { id: "s1" }, user: { _id: "u1" } }, res);

    expect(space.save).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  test("joinWaitList returns 404 for an unknown space", async () => {
    Space.findById.mockResolvedValue(null);
    const res = mockRes();

    await spaces.joinWaitList({ params: { id: "nope" }, user: { _id: "u1" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
  });

  test("updateSpace ends a space by setting status and ignores non-whitelisted fields", async () => {
    const ended = { _id: "s1", status: "ended" };
    Space.findByIdAndUpdate.mockReturnValue(populated(ended));
    const res = mockRes();

    await spaces.updateSpace(
      { params: { id: "s1" }, body: { status: "ended", host: "evil" }, resource: { _id: "s1" } },
      res
    );

    expect(Space.findByIdAndUpdate).toHaveBeenCalledWith("s1", { status: "ended" }, { new: true });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, space: ended });
  });

  test("updateSpace returns 404 when the space does not exist", async () => {
    Space.findById.mockResolvedValue(null);
    const res = mockRes();

    await spaces.updateSpace({ params: { id: "nope" }, body: { status: "ended" } }, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(Space.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  test("getSpaceById returns 404 when missing and the space when found", async () => {
    Space.findById.mockReturnValueOnce(populated(null)).mockReturnValueOnce(populated({ _id: "s1" }));
    const res1 = mockRes();
    await spaces.getSpaceById({ params: { id: "x" } }, res1);
    expect(res1.status).toHaveBeenCalledWith(404);

    const res2 = mockRes();
    await spaces.getSpaceById({ params: { id: "s1" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(200);
    expect(res2.json).toHaveBeenCalledWith({ success: true, space: { _id: "s1" } });
  });

  test("deleteSpace deletes an existing space and 404s otherwise", async () => {
    Space.findByIdAndDelete.mockResolvedValue({});
    const res = mockRes();
    await spaces.deleteSpace({ params: { id: "s1" }, resource: { _id: "s1" } }, res);
    expect(Space.findByIdAndDelete).toHaveBeenCalledWith("s1");
    expect(res.status).toHaveBeenCalledWith(200);

    Space.findById.mockResolvedValue(null);
    const res2 = mockRes();
    await spaces.deleteSpace({ params: { id: "nope" } }, res2);
    expect(res2.status).toHaveBeenCalledWith(404);
  });

  test("getSpaces lists spaces and returns 500 on failure", async () => {
    Space.find.mockReturnValueOnce(populated([{ _id: "s1" }]));
    const res = mockRes();
    await spaces.getSpaces({}, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, spaces: [{ _id: "s1" }] });

    Space.find.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const res2 = mockRes();
    await spaces.getSpaces({}, res2);
    expect(res2.status).toHaveBeenCalledWith(500);
  });
});

describe("spaceRecordingController", () => {
  const user = { _id: "host1" };

  test("startSpaceRecording returns 201 with the recording", async () => {
    startRecording.mockResolvedValue({ _id: "r1" });
    const res = mockRes();
    const next = jest.fn();

    await recordings.startSpaceRecording({ params: { spaceId: "s1" }, user, body: { url: "u" } }, res, next);

    expect(startRecording).toHaveBeenCalledWith("s1", "host1", { url: "u" });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: "r1" } });
    expect(next).not.toHaveBeenCalled();
  });

  test("startSpaceRecording forwards service errors to next", async () => {
    const err = new Error("not host");
    startRecording.mockRejectedValue(err);
    const res = mockRes();
    const next = jest.fn();

    await recordings.startSpaceRecording({ params: { spaceId: "s1" }, user, body: {} }, res, next);

    expect(next).toHaveBeenCalledWith(err);
    expect(res.json).not.toHaveBeenCalled();
  });

  test("finaliseSpaceRecording returns the finalised recording", async () => {
    finaliseRecording.mockResolvedValue({ _id: "r1", status: "ready" });
    const res = mockRes();

    await recordings.finaliseSpaceRecording(
      { params: { recordingId: "r1" }, body: { duration: 10 } },
      res,
      jest.fn()
    );

    expect(finaliseRecording).toHaveBeenCalledWith("r1", { duration: 10 });
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: "r1", status: "ready" } });
  });

  test("getSpaceRecordings coerces pagination and spreads the result", async () => {
    listRecordingsForSpace.mockResolvedValue({ recordings: [], total: 0 });
    const res = mockRes();

    await recordings.getSpaceRecordings({ params: { spaceId: "s1" }, query: { page: "2", limit: "5" } }, res, jest.fn());

    expect(listRecordingsForSpace).toHaveBeenCalledWith("s1", { page: 2, limit: 5 });
    expect(res.json).toHaveBeenCalledWith({ success: true, recordings: [], total: 0 });
  });

  test("getSpaceRecording and deleteSpaceRecording succeed; delete forwards errors", async () => {
    getRecordingById.mockResolvedValue({ _id: "r1" });
    const res = mockRes();
    await recordings.getSpaceRecording({ params: { recordingId: "r1" } }, res, jest.fn());
    expect(res.json).toHaveBeenCalledWith({ success: true, data: { _id: "r1" } });

    deleteRecording.mockResolvedValueOnce();
    const res2 = mockRes();
    await recordings.deleteSpaceRecording({ params: { recordingId: "r1" }, user }, res2, jest.fn());
    expect(deleteRecording).toHaveBeenCalledWith("r1", "host1");
    expect(res2.json).toHaveBeenCalledWith({ success: true, message: "Recording deleted" });

    const err = new Error("forbidden");
    deleteRecording.mockRejectedValueOnce(err);
    const next = jest.fn();
    await recordings.deleteSpaceRecording({ params: { recordingId: "r1" }, user }, mockRes(), next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
