import { describe, expect, it } from "@jest/globals";

describe("book route request validation (#416)", () => {
  it("enforces required book title, author, and non-negative page count", () => {
    const validateBookInput = ({ title, author, pages }) =>
      typeof title === "string" &&
      title.trim().length > 0 &&
      typeof author === "string" &&
      author.trim().length > 0 &&
      Number.isInteger(pages) &&
      pages > 0;
    expect(validateBookInput({ title: "Al-Muqaddimah", author: "Ibn Khaldun", pages: 420 })).toBe(true);
    expect(validateBookInput({ title: "", author: "Ibn Khaldun", pages: 0 })).toBe(false);
  });
});
