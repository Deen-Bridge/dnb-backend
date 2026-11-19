import { describe, expect, it, jest } from "@jest/globals";
import {
  createCsrfToken,
  csrfProtection,
  isAllowedBrowserOrigin,
} from "../src/middlewares/csrfProtection.js";

const makeResponse = () => ({
  status: jest.fn().mockReturnThis(),
  json: jest.fn().mockReturnThis(),
});

describe("cookie-session CSRF boundary (#725)", () => {
  it("allows configured browser origins and rejects null or unknown origins", () => {
    expect(isAllowedBrowserOrigin("http://localhost:3000")).toBe(true);
    expect(isAllowedBrowserOrigin("null")).toBe(false);
    expect(isAllowedBrowserOrigin("https://evil.example")).toBe(false);
  });

  it("requires an origin and matching double-submit token for cookie mutations", () => {
    const token = createCsrfToken();
    const req = {
      method: "POST",
      path: "/api/auth/refresh",
      cookies: { refreshToken: "refresh", csrfToken: token },
      headers: { origin: "http://localhost:3000" },
      get: (name) => (name === "x-csrf-token" ? token : undefined),
    };
    const next = jest.fn();

    csrfProtection(req, makeResponse(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it("rejects cookie mutations without a valid CSRF token", () => {
    const res = makeResponse();
    const req = {
      method: "POST",
      path: "/api/auth/refresh",
      cookies: { refreshToken: "refresh", csrfToken: "cookie-token" },
      headers: { origin: "http://localhost:3000" },
      get: () => "wrong-token",
    };

    csrfProtection(req, res, jest.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CSRF_TOKEN_REQUIRED" })
    );
  });

  it("does not apply cookie CSRF checks to bearer-only requests", () => {
    const next = jest.fn();
    csrfProtection(
      {
        method: "POST",
        path: "/api/payouts",
        cookies: {},
        headers: { authorization: "Bearer access-token" },
        get: jest.fn(),
      },
      makeResponse(),
      next
    );

    expect(next).toHaveBeenCalledTimes(1);
  });
});
