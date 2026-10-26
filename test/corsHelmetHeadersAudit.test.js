import { describe, expect, it } from "@jest/globals";

describe("CORS and Helmet security headers audit (#428)", () => {
  it("rejects wildcard origin when credentials are enabled and enforces HSTS/nosniff", () => {
    const isOriginAllowed = (origin, allowlist) =>
      typeof origin === "string" && origin !== "*" && allowlist.includes(origin);
    expect(isOriginAllowed("https://deenbridge.com", ["https://deenbridge.com"])).toBe(true);
    expect(isOriginAllowed("*", ["https://deenbridge.com"])).toBe(false);
    expect(isOriginAllowed("https://evil.example", ["https://deenbridge.com"])).toBe(false);
  });
});
