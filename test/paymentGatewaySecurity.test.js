import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";

const logger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
};

const userModel = { findById: jest.fn() };

jest.unstable_mockModule("../src/config/logger.js", () => ({ default: logger }));
jest.unstable_mockModule("../src/models/User.js", () => ({ default: userModel }));

const originalSecret = process.env.JWT_SECRET;

delete process.env.JWT_SECRET;
const { authenticateSocket: authWithoutSecret } = await import(
  "../src/sockets/paymentGateway.js"
);

const configuredSecret = "test-secret-key-at-least-32-characters-long";
process.env.JWT_SECRET = configuredSecret;
let authWithSecret;
await jest.isolateModulesAsync(async () => {
  ({ authenticateSocket: authWithSecret } = await import(
    "../src/sockets/paymentGateway.js"
  ));
});

if (originalSecret === undefined) {
  delete process.env.JWT_SECRET;
} else {
  process.env.JWT_SECRET = originalSecret;
}

const userId = "507f1f77bcf86cd799439011";
const socketWithToken = (token) => ({
  handshake: { auth: { token } },
  data: {},
});

describe("payment gateway JWT configuration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects handshakes when JWT_SECRET is not configured", async () => {
    const next = jest.fn();

    await authWithoutSecret(socketWithToken("token"), next);

    expect(next).toHaveBeenCalledWith(new Error("Authentication unavailable"));
    expect(logger.error).toHaveBeenCalledWith(
      "Socket authentication unavailable: JWT_SECRET is not configured"
    );
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  it("accepts a valid token when JWT_SECRET is configured", async () => {
    userModel.findById.mockReturnValue({
      select: jest.fn().mockResolvedValue({ _id: userId }),
    });
    const next = jest.fn();
    const token = jwt.sign({ userId }, configuredSecret, { expiresIn: "1h" });

    await authWithSecret(socketWithToken(token), next);

    expect(userModel.findById).toHaveBeenCalledWith(userId);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects an expired token", async () => {
    const next = jest.fn();
    const token = jwt.sign(
      { userId, exp: Math.floor(Date.now() / 1000) - 10 },
      configuredSecret
    );

    await authWithSecret(socketWithToken(token), next);

    expect(next).toHaveBeenCalledWith(new Error("Not authorized, token failed"));
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  it("rejects a malformed token", async () => {
    const next = jest.fn();

    await authWithSecret(socketWithToken("not-a-jwt"), next);

    expect(next).toHaveBeenCalledWith(new Error("Not authorized, token failed"));
    expect(userModel.findById).not.toHaveBeenCalled();
  });

  it("rejects a token forged with a different secret", async () => {
    const next = jest.fn();
    const token = jwt.sign({ userId }, "a-different-secret-of-32-characters");

    await authWithSecret(socketWithToken(token), next);

    expect(next).toHaveBeenCalledWith(new Error("Not authorized, token failed"));
    expect(userModel.findById).not.toHaveBeenCalled();
  });
});
