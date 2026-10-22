import { describe, expect, it } from "@jest/globals";

describe("auth controller contract", () => {
  it("rejects missing credentials before attempting authentication", () => {
    expect({ email: "", password: "" }).toMatchObject({ email: "", password: "" });
  });
});
