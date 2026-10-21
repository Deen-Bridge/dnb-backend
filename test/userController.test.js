import { jest } from "@jest/globals";

// Handler-level unit tests: DB models, Cloudinary and collaborators are mocked,
// so no MongoDB/Redis connection is needed.
const User = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
const upload_stream = jest.fn();
const validateMagicBytes = jest.fn();
const getUserBadges = jest.fn();
const UserPreferences = {
  findOne: jest.fn(),
  create: jest.fn(),
  findOneAndUpdate: jest.fn(),
};
const emitPreferenceUpdate = jest.fn();
const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

jest.unstable_mockModule("../src/models/User.js", () => ({ default: User }));
jest.unstable_mockModule("../src/models/Course.js", () => ({ default: {} }));
jest.unstable_mockModule("../src/models/Book.js", () => ({ default: {} }));
jest.unstable_mockModule("../src/models/CourseProgress.js", () => ({ default: {} }));
jest.unstable_mockModule("../src/models/UserPreferences.js", () => ({ default: UserPreferences }));
jest.unstable_mockModule("../src/utils/cloudinary.js", () => ({
  default: { uploader: { upload_stream } },
}));
jest.unstable_mockModule("../src/utils/fileValidation.js", () => ({ validateMagicBytes }));
jest.unstable_mockModule("../src/config/logger.js", () => ({ default: logger }));
jest.unstable_mockModule("../src/controllers/notificationController.js", () => ({
  createFollowNotification: jest.fn(),
  createUnfollowNotification: jest.fn(),
}));
jest.unstable_mockModule("../src/services/badge.service.js", () => ({
  default: { getUserBadges },
}));
jest.unstable_mockModule("../src/middlewares/authMiddleware.js", () => ({
  protect: (_req, _res, next) => next(),
}));
jest.unstable_mockModule("../src/sockets/preferences.socket.js", () => ({
  emitPreferenceUpdate,
}));

const { updateUser, getUser } = await import("../src/controllers/userController.js");
const {
  getUserPreferences,
  updateUserPreferences,
  validatePreferencesInput,
} = await import("../src/routes/api/users/preferences.js");

const mockRes = () => {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};
const idOf = (s) => ({ toString: () => s, _id: s });

// getUser chains findById().lean().select() and awaits the result.
const mockFindByIdChain = (result, { reject } = {}) => {
  const query = {
    lean: jest.fn().mockReturnThis(),
    select: jest.fn().mockReturnThis(),
    then: (resolve, rej) =>
      (reject ? Promise.reject(reject) : Promise.resolve(result)).then(resolve, rej),
  };
  User.findById.mockReturnValue(query);
  return query;
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("userController.updateUser", () => {
  const owner = { _id: idOf("u1"), role: "student" };

  it("updates allowed fields and drops disallowed ones", async () => {
    const saved = { _id: "u1", name: "New" };
    User.findByIdAndUpdate.mockResolvedValue(saved);
    const res = mockRes();

    await updateUser(
      { user: owner, params: { id: "u1" }, body: { name: "New", role: "admin", password: "x" } },
      res
    );

    expect(User.findByIdAndUpdate).toHaveBeenCalledWith(
      "u1",
      { name: "New" },
      { new: true, runValidators: true }
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, user: saved });
  });

  it("uploads an avatar to Cloudinary and stores the secure URL", async () => {
    validateMagicBytes.mockResolvedValue(true);
    upload_stream.mockImplementation((_opts, cb) => ({
      end: () => cb(null, { secure_url: "https://cdn/avatar.png" }),
    }));
    User.findByIdAndUpdate.mockResolvedValue({ _id: "u1" });
    const res = mockRes();

    await updateUser(
      { user: owner, params: { id: "u1" }, body: {}, file: { buffer: Buffer.from("img") } },
      res
    );

    expect(upload_stream).toHaveBeenCalledWith({ folder: "user-avatars" }, expect.any(Function));
    expect(User.findByIdAndUpdate.mock.calls[0][1]).toEqual({ avatar: "https://cdn/avatar.png" });
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 403 when updating another user's profile as non-admin", async () => {
    const res = mockRes();
    await updateUser({ user: owner, params: { id: "other" }, body: { name: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 404 when the user does not exist", async () => {
    User.findByIdAndUpdate.mockResolvedValue(null);
    const res = mockRes();
    await updateUser({ user: owner, params: { id: "u1" }, body: { name: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: "User not found" });
  });

  it("returns 400 for an uploaded file with invalid magic bytes", async () => {
    validateMagicBytes.mockResolvedValue(false);
    const res = mockRes();
    await updateUser(
      { user: owner, params: { id: "u1" }, body: {}, file: { buffer: Buffer.from("x") } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(upload_stream).not.toHaveBeenCalled();
  });

  it("returns 500 when the Cloudinary upload fails", async () => {
    validateMagicBytes.mockResolvedValue(true);
    upload_stream.mockImplementation((_opts, cb) => ({ end: () => cb(new Error("boom")) }));
    const res = mockRes();
    await updateUser(
      { user: owner, params: { id: "u1" }, body: {}, file: { buffer: Buffer.from("x") } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(User.findByIdAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 409 on a duplicate email", async () => {
    User.findByIdAndUpdate.mockRejectedValue(Object.assign(new Error("E11000 dup"), { code: 11000 }));
    const res = mockRes();
    await updateUser({ user: owner, params: { id: "u1" }, body: { email: "a@b.c" } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 500 on an unexpected database error", async () => {
    User.findByIdAndUpdate.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    await updateUser({ user: owner, params: { id: "u1" }, body: { name: "x" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("userController.getUser", () => {
  it("returns the public profile with badges for another viewer", async () => {
    const query = mockFindByIdChain({ _id: "u2", name: "Bob" });
    getUserBadges.mockResolvedValue([{ id: "b1" }]);
    const res = mockRes();

    await getUser({ user: { _id: idOf("u1") }, params: { id: "u2" } }, res);

    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("name avatar bio"));
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      user: { _id: "u2", name: "Bob", badges: [{ id: "b1" }] },
    });
  });

  it("excludes secrets rather than restricting fields when viewing self", async () => {
    const query = mockFindByIdChain({ _id: "u1" });
    getUserBadges.mockResolvedValue([]);
    await getUser({ user: { _id: idOf("u1") }, params: { id: "u1" } }, mockRes());
    expect(query.select).toHaveBeenCalledWith(expect.stringContaining("-password"));
  });

  it("falls back to empty badges when the badge service fails", async () => {
    mockFindByIdChain({ _id: "u2" });
    getUserBadges.mockRejectedValue(new Error("badge down"));
    const res = mockRes();
    await getUser({ user: { _id: idOf("u1") }, params: { id: "u2" } }, res);
    expect(res.json.mock.calls[0][0].user.badges).toEqual([]);
  });

  it("returns 404 when not found", async () => {
    mockFindByIdChain(null);
    const res = mockRes();
    await getUser({ user: { _id: idOf("u1") }, params: { id: "nope" } }, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 500 when the query throws", async () => {
    mockFindByIdChain(null, { reject: new Error("db down") });
    const res = mockRes();
    await getUser({ user: { _id: idOf("u1") }, params: { id: "u2" } }, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("user preferences", () => {
  const user = { _id: idOf("u1") };

  describe("getUserPreferences", () => {
    it("returns existing preferences", async () => {
      const prefs = { theme: "dark" };
      UserPreferences.findOne.mockResolvedValue(prefs);
      const res = mockRes();
      await getUserPreferences({ user }, res);
      expect(UserPreferences.findOne).toHaveBeenCalledWith({ user: user._id });
      expect(UserPreferences.create).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json.mock.calls[0][0].data).toBe(prefs);
    });

    it("creates default preferences when none exist", async () => {
      const created = { theme: "system" };
      UserPreferences.findOne.mockResolvedValue(null);
      UserPreferences.create.mockResolvedValue(created);
      const res = mockRes();
      await getUserPreferences({ user }, res);
      expect(UserPreferences.create).toHaveBeenCalledWith({ user: user._id });
      expect(res.json.mock.calls[0][0].data).toBe(created);
    });

    it("returns 401 without an authenticated user", async () => {
      const res = mockRes();
      await getUserPreferences({}, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("returns 500 when the lookup throws", async () => {
      UserPreferences.findOne.mockRejectedValue(new Error("db down"));
      const res = mockRes();
      await getUserPreferences({ user }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json.mock.calls[0][0].error).toBe("db down");
    });
  });

  describe("updateUserPreferences", () => {
    it("applies a dotted $set, syncs language and emits the update", async () => {
      const prefs = { toObject: () => ({ theme: "dark" }) };
      UserPreferences.findOneAndUpdate.mockResolvedValue(prefs);
      User.findByIdAndUpdate.mockReturnValue(Promise.resolve());
      const res = mockRes();

      await updateUserPreferences(
        {
          user,
          body: {
            theme: "dark",
            language: " fr ",
            notifications: { email: false },
            privacy: { profileVisibility: "private" },
          },
        },
        res
      );

      expect(UserPreferences.findOneAndUpdate).toHaveBeenCalledWith(
        { user: user._id },
        {
          $set: {
            theme: "dark",
            language: "fr",
            "notifications.email": false,
            "privacy.profileVisibility": "private",
          },
        },
        { new: true, upsert: true, runValidators: true }
      );
      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(user._id, { language: "fr" });
      expect(emitPreferenceUpdate).toHaveBeenCalledWith("u1", { theme: "dark" });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("returns 400 with errors for invalid input and does not write", async () => {
      const res = mockRes();
      await updateUserPreferences(
        { user, body: { theme: "neon", notifications: { push: "yes" } } },
        res
      );
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json.mock.calls[0][0].errors).toHaveLength(2);
      expect(UserPreferences.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it("returns 401 without an authenticated user", async () => {
      const res = mockRes();
      await updateUserPreferences({ body: { theme: "dark" } }, res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("still succeeds when the language sync to the User profile fails", async () => {
      UserPreferences.findOneAndUpdate.mockResolvedValue({ toObject: () => ({}) });
      User.findByIdAndUpdate.mockReturnValue(Promise.reject(new Error("sync fail")));
      const res = mockRes();
      await updateUserPreferences({ user, body: { language: "ar" } }, res);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(logger.warn).toHaveBeenCalled();
    });

    it("returns 500 when the update throws", async () => {
      UserPreferences.findOneAndUpdate.mockRejectedValue(new Error("db down"));
      const res = mockRes();
      await updateUserPreferences({ user, body: { theme: "light" } }, res);
      expect(res.status).toHaveBeenCalledWith(500);
      expect(emitPreferenceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("validatePreferencesInput", () => {
    it("accepts valid values and rejects bad enums/types", () => {
      expect(validatePreferencesInput({ fontSize: "large" })).toEqual({
        errors: [],
        updates: { fontSize: "large" },
      });
      const { errors } = validatePreferencesInput({
        fontSize: "huge",
        language: "  ",
        privacy: null,
      });
      expect(errors).toHaveLength(3);
    });
  });
});
