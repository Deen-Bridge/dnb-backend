import { jest } from "@jest/globals";
import { createHealthHandler, ping } from "../src/controllers/healthController.js";

const createResponse = () => {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  res.send.mockReturnValue(res);
  return res;
};

describe("Health endpoints", () => {
  it("returns healthy readiness metadata when critical dependencies are ready", () => {
    const handler = createHealthHandler({
      getMongoReadyState: () => 1,
      getRedisReady: () => true,
      getUptime: () => 42.5,
      getEnvironment: () => "test",
    });
    const res = createResponse();

    handler({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      message: "All critical dependencies are ready",
      data: {
        status: "healthy",
        timestamp: expect.any(String),
        uptime: 42.5,
        environment: "test",
        dependencies: {
          mongodb: {
            status: "up",
            state: "connected",
          },
          redis: {
            status: "up",
          },
        },
      },
    });
  });

  it.each([
    {
      name: "MongoDB",
      mongoReadyState: 0,
      redisReady: true,
      expectedMongoState: "disconnected",
    },
    {
      name: "Redis",
      mongoReadyState: 1,
      redisReady: false,
      expectedMongoState: "connected",
    },
  ])(
    "returns unavailable readiness when $name is down",
    ({ mongoReadyState, redisReady, expectedMongoState }) => {
      const handler = createHealthHandler({
        getMongoReadyState: () => mongoReadyState,
        getRedisReady: () => redisReady,
        getUptime: () => 10,
        getEnvironment: () => "test",
      });
      const res = createResponse();

      handler({}, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          message: "One or more critical dependencies are unavailable",
          data: {
            status: "unhealthy",
            timestamp: expect.any(String),
            uptime: 10,
            environment: "test",
            dependencies: {
              mongodb: {
                status: mongoReadyState === 1 ? "up" : "down",
                state: expectedMongoState,
              },
              redis: {
                status: redisReady ? "up" : "down",
              },
            },
          },
        })
      );
    }
  );

  it("keeps ping independent from dependency probes", () => {
    const res = createResponse();

    ping({}, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith("pong");
  });
});
