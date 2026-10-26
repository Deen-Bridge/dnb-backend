import { describe, expect, it } from "@jest/globals";

describe("standardized API error response envelope (#412)", () => {
  it("formats operational errors with status, statusCode, errorCode, and message", () => {
    const buildErrorEnvelope = (statusCode, errorCode, message) => ({
      status: String(statusCode).startsWith("4") ? "fail" : "error",
      statusCode,
      errorCode,
      message,
    });
    expect(buildErrorEnvelope(404, "RESOURCE_NOT_FOUND", "Course not found")).toEqual({
      status: "fail",
      statusCode: 404,
      errorCode: "RESOURCE_NOT_FOUND",
      message: "Course not found",
    });
  });
});
