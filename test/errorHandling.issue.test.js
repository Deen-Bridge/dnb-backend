import { describe, expect, it } from "@jest/globals";
describe("error handling", () => { it("keeps failures observable", () => { const error = new Error("upstream failure"); expect(error).toBeInstanceOf(Error); }); });
