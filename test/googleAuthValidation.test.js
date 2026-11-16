import { validationResult } from "express-validator";
import { googleAuthValidation } from "../src/validators/authValidators.js";

async function validateGoogleToken(idToken) {
  const req = { body: { idToken } };
  await Promise.all(googleAuthValidation.map((validator) => validator.run(req)));
  return validationResult(req).array();
}

describe("Google ID-token validation", () => {
  test("accepts an ID token longer than the normal user-input limit", async () => {
    const errors = await validateGoogleToken("a".repeat(2_000));

    expect(errors).toHaveLength(0);
  });

  test("still rejects an unbounded token payload", async () => {
    const errors = await validateGoogleToken("a".repeat(8_193));

    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "idToken",
          msg: "ID token is too long",
        }),
      ])
    );
  });
});
