import { jest } from "@jest/globals";

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const userModel = { findById: jest.fn() };

jest.unstable_mockModule("../src/config/logger.js", () => ({ default: logger }));
jest.unstable_mockModule("../src/models/User.js", () => ({ default: userModel }));

delete process.env.JWT_SECRET;

const { authenticateSocket } = await import("../src/sockets/paymentGateway.js");

describe("payment gateway JWT configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects handshakes when JWT_SECRET is not configured", async () => {
    const socket = { handshake: { auth: { token: "token" } } };
    const next = jest.fn();

    await authenticateSocket(socket, next);

    expect(next).toHaveBeenCalledWith(new Error("Authentication unavailable"));
    expect(logger.error).toHaveBeenCalledWith(
      "Socket authentication unavailable: JWT_SECRET is not configured"
    );
    expect(userModel.findById).not.toHaveBeenCalled();
  });
});
