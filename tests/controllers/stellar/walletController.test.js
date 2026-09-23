/**
 * @jest-environment node
 */

const mongoose = require("mongoose");
const { checkUserWallet } = require("../../../src/controllers/stellar/walletController");

// Mock the UserRepository used inside the controller
jest.mock("../../../mongo/repositories/UserRepository", () => ({
  findById: jest.fn(),
}));

const UserRepository = require("../../../mongo/repositories/UserRepository");

describe("walletController.checkUserWallet", () => {
  let req, res, next;

  beforeEach(() => {
    req = { params: {} };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("returns 400 when userId is not a valid ObjectId", async () => {
    req.params.userId = "invalid-id";

    await checkUserWallet(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "Invalid user ID format.",
    });
    expect(UserRepository.findById).not.toHaveBeenCalled();
  });

  test("returns 404 when user does not exist", async () => {
    const validId = new mongoose.Types.ObjectId().toHexString();
    req.params.userId = validId;

    UserRepository.findById.mockResolvedValue(null);

    await checkUserWallet(req, res, next);

    expect(UserRepository.findById).toHaveBeenCalledWith(validId, {
      select: "stellarPublicKey name",
    });
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      message: "User not found.",
    });
  });

  test("returns wallet status and name when user exists", async () => {
    const validId = new mongoose.Types.ObjectId().toHexString();
    req.params.userId = validId;

    const mockUser = {
      stellarPublicKey: "GABCD1234EXAMPLEPUBLICKEYFORTESTINGPURPOSES1234567",
      name: "Test User",
    };
    UserRepository.findById.mockResolvedValue(mockUser);

    await checkUserWallet(req, res, next);

    expect(UserRepository.findById).toHaveBeenCalledWith(validId, {
      select: "stellarPublicKey name",
    });
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        hasWallet: true,
        name: "Test User",
      },
    });
  });
});
