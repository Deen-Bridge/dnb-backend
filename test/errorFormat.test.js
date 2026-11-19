import { jest } from "@jest/globals";
import { APIError, errorHandler, catchAsync, notFound } from "../src/middlewares/errorHandler.js";
import { ERROR_CODES } from "../src/config/errorCodes.js";

describe("Standardized error response format", () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = { id: "test-req-id", originalUrl: "/api/test" };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };
    next = jest.fn();
  });

  describe("APIError", () => {
    it("infers error code from status code 400", () => {
      const err = new APIError("Bad request", 400);
      expect(err.errorCode).toBe(ERROR_CODES.VALIDATION_ERROR);
    });

    it("infers error code from status code 401", () => {
      const err = new APIError("Unauthorized", 401);
      expect(err.errorCode).toBe(ERROR_CODES.UNAUTHORIZED);
    });

    it("infers error code from status code 403", () => {
      const err = new APIError("Forbidden", 403);
      expect(err.errorCode).toBe(ERROR_CODES.FORBIDDEN);
    });

    it("infers error code from status code 404", () => {
      const err = new APIError("Not found", 404);
      expect(err.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    });

    it("infers error code from status code 409", () => {
      const err = new APIError("Conflict", 409);
      expect(err.errorCode).toBe(ERROR_CODES.CONFLICT);
    });

    it("infers error code from status code 500", () => {
      const err = new APIError("Server error", 500);
      expect(err.errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
    });

    it("defaults to INTERNAL_ERROR for unknown status codes", () => {
      const err = new APIError("Custom", 418);
      expect(err.errorCode).toBe(ERROR_CODES.INTERNAL_ERROR);
    });
  });

  describe("errorHandler middleware", () => {
    it("does not throw when duplicate-key metadata is malformed", () => {
      const err = new Error("duplicate");
      err.code = 11000;

      expect(() => errorHandler(err, req, res, next)).not.toThrow();
      const body = res.json.mock.calls[0][0];
      expect(body.error.code).toBe(ERROR_CODES.CONFLICT);
      expect(body.error.message).toBe("A record with those details already exists.");
      expect(JSON.stringify(body)).not.toContain("duplicate");
    });

    it("uses a safe response for unknown environment values", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "staging-misconfigured";
      const err = new Error("driver secret and stack details");

      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(body.error.message).toBe("Something went wrong!");
      expect(body.stack).toBeUndefined();
      expect(body.error.details).toBeUndefined();
      process.env.NODE_ENV = originalEnv;
    });

    it("sanitizes validation details and preserves the correlation id", () => {
      const err = new Error("raw provider payload");
      err.name = "ValidationError";
      err.errors = {
        "profile.email": { message: "email value leaked" },
        token: { message: "token leaked" },
      };

      errorHandler(err, { headers: { "x-request-id": "corr-123" } }, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.reqId).toBe("corr-123");
      expect(body.error.details).toEqual([
        { field: "profile.email", message: "Invalid value." },
        { field: "token", message: "Invalid value." },
      ]);
      expect(JSON.stringify(body)).not.toContain("leaked");
    });

    it("forwards errors when the response has already started", () => {
      const err = new Error("late failure");
      errorHandler(err, { id: "late-1" }, { headersSent: true }, next);

      expect(next).toHaveBeenCalledWith(err);
      expect(res.json).not.toHaveBeenCalled();
    });

    it("returns standard error envelope for operational errors", () => {
      const err = new APIError("Not found", 404, true);
      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(404);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe(ERROR_CODES.NOT_FOUND);
      expect(body.error.message).toBe("Not found");
      // Backward-compatible top-level fields
      expect(body.message).toBe("Not found");
      expect(body.status).toBe("fail");
      expect(body.data).toBeNull();
    });

    it("returns standard error envelope for validation errors with details", () => {
      const err = new APIError("Invalid input", 400);
      err.details = [{ field: "email", message: "Invalid format" }];
      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ERROR_CODES.VALIDATION_ERROR);
      expect(body.error.details).toEqual([{ field: "email", message: "Invalid format" }]);
    });

    it("hides internal error details in production", () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const err = new APIError("Internal failure", 500, false);
      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ERROR_CODES.INTERNAL_ERROR);
      expect(body.error.message).toBe("Something went wrong!");
      expect(body.stack).toBeUndefined();

      process.env.NODE_ENV = originalEnv;
    });

    it("handles MulterError with PAYLOAD_TOO_LARGE code", () => {
      const err = new Error("File too large");
      err.name = "MulterError";
      err.code = "LIMIT_FILE_SIZE";
      errorHandler(err, req, res, next);

      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ERROR_CODES.PAYLOAD_TOO_LARGE);
      expect(body.error.message).toBe("File too large. Please upload a smaller file.");
    });

    it("handles AllEndpointsOpenError with NETWORK_UNAVAILABLE code", () => {
      const err = new Error("All endpoints open");
      err.name = "AllEndpointsOpenError";
      errorHandler(err, req, res, next);

      expect(res.status).toHaveBeenCalledWith(503);
      const body = res.json.mock.calls[0][0];
      expect(body.success).toBe(false);
      expect(body.error.code).toBe(ERROR_CODES.NETWORK_UNAVAILABLE);
    });
  });

  describe("notFound middleware", () => {
    it("creates a 404 APIError with NOT_FOUND code", () => {
      notFound(req, res, next);
      expect(next).toHaveBeenCalledWith(expect.any(APIError));
      const err = next.mock.calls[0][0];
      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe(ERROR_CODES.NOT_FOUND);
    });
  });

  describe("catchAsync", () => {
    it("catches rejected promises and forwards to next", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("Async error"));
      const handler = catchAsync(fn);

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(Error));
      expect(next.mock.calls[0][0].message).toBe("Async error");
    });

    it("forwards synchronous handler failures", async () => {
      const error = new Error("Sync error");
      const handler = catchAsync(() => { throw error; });

      await handler(req, res, next);

      expect(next).toHaveBeenCalledWith(error);
    });
  });
});
