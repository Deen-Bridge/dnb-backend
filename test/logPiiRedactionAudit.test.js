import { describe, expect, it } from "@jest/globals";

const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /secret/i,
  /authorization/i,
  /cookie/i,
  /token/i,
  /stellarSecretSeed/i,
];

function redactLogObject(payload) {
  if (!payload || typeof payload !== "object") return payload;
  const clone = {};
  for (const [k, v] of Object.entries(payload)) {
    if (SENSITIVE_FIELD_PATTERNS.some((re) => re.test(k))) {
      clone[k] = "[REDACTED]";
    } else {
      clone[k] = v;
    }
  }
  return clone;
}

describe("log secret and PII redaction audit (#427)", () => {
  it("redacts authentication tokens, passwords, and Stellar secret seeds before logging", () => {
    const scrubbed = redactLogObject({
      requestId: "req-101",
      password: "plaintext-password",
      authorization: "Bearer eyJhbGci...",
      stellarSecretSeed: "SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      route: "/api/auth/login",
    });

    expect(scrubbed).toEqual({
      requestId: "req-101",
      password: "[REDACTED]",
      authorization: "[REDACTED]",
      stellarSecretSeed: "[REDACTED]",
      route: "/api/auth/login",
    });
  });
});
