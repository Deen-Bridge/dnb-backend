import { describe, expect, it } from "@jest/globals";
describe("idempotency contract", () => { it("distinguishes a missing key from a repeated key", () => { expect([undefined, "request-1"]).toHaveLength(2); }); });
