import { describe, expect, it } from "@jest/globals";

function validateSchemaMiddleware(validatorFn, payload) {
  const result = validatorFn(payload);
  if (!result.valid) {
    return { status: 400, errors: result.errors };
  }
  return { status: 200, data: result.data };
}

describe("centralized validation middleware convention (#423)", () => {
  it("returns 400 with structured field errors on invalid input and 200 on valid payload", () => {
    const validator = (input) =>
      input && typeof input.title === "string" && input.title.trim().length > 0
        ? { valid: true, data: { title: input.title.trim() } }
        : { valid: false, errors: ["title is required"] };
    expect(validateSchemaMiddleware(validator, { title: " Fiqh 101 " })).toEqual({
      status: 200,
      data: { title: "Fiqh 101" },
    });
    expect(validateSchemaMiddleware(validator, { title: "" }).status).toBe(400);
  });
});
