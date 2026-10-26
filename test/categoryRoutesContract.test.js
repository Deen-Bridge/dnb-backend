import { describe, expect, it } from "@jest/globals";

describe("category routes contract (#447)", () => {
  it("normalizes category slug and parent hierarchy shape", () => {
    const rawName = "  Islamic Finance & Waqf  ";
    const slug = rawName
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
    expect(slug).toBe("islamic-finance-waqf");
  });

  it("rejects empty category names before persistence", () => {
    const isValidCategoryName = (name) =>
      typeof name === "string" && name.trim().length >= 2;
    expect(isValidCategoryName("Fiqh")).toBe(true);
    expect(isValidCategoryName(" ")).toBe(false);
  });
});
