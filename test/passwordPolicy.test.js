import {
  PASSWORD_MIN,
  PASSWORD_MAX,
  passwordIssues,
  isPasswordAcceptable,
  firstPasswordIssue,
} from "../src/utils/passwordPolicy.js";

const CONTEXT = { name: "Aisha Bello", email: "aishabello@example.com" };

describe("password policy", () => {
  describe("rejects weak passwords", () => {
    const weak = [
      ["too short", "Ab3!x"],
      ["single character class", "password"],
      ["digits only", "12345678"],
      ["letters only", "abcdefgh"],
      ["common word with decoration", "Password123!"],
      ["common word, leet-substituted", "P@ssw0rd123!"],
      ["common keyboard walk", "Qwerty123!"],
      ["brand name", "Deenbridge!23"],
      ["padded with symbols", "!!Admin!!"],
      ["contains the user's name", "aishabello1!A"],
      ["contains the email local part", "Xy!aishabello9"],
      ["repeated character run", "Aaa1!bbb"],
      ["ascending sequence", "abcd1234EF!"],
      ["descending sequence", "Zyxw!987q"],
      ["leading space", " Str0ng!Pass"],
      ["trailing space", "Str0ng!Pass "],
    ];

    test.each(weak)("%s", (_label, password) => {
      expect(isPasswordAcceptable(password, CONTEXT)).toBe(false);
      expect(passwordIssues(password, CONTEXT).length).toBeGreaterThan(0);
    });
  });

  describe("accepts strong passwords", () => {
    const strong = [
      ["mixed classes", "Str0ng!Pass"],
      ["passphrase", "correct horse battery staple 7Z"],
      ["domain words, not blocklisted", "Tajweed#Halaqah42"],
      ["random-looking", "Mgx7#qLpv2"],
      ["three classes, no symbol", "Qamar91Zubayr"],
    ];

    test.each(strong)("%s", (_label, password) => {
      expect(passwordIssues(password, CONTEXT)).toEqual([]);
      expect(isPasswordAcceptable(password, CONTEXT)).toBe(true);
    });
  });

  describe("length bounds", () => {
    it(`requires at least ${PASSWORD_MIN} characters`, () => {
      // 7 chars, three classes, nothing else wrong — only length should fail.
      expect(passwordIssues("Ab3!xQz".slice(0, 7), CONTEXT)).toContain(
        `Password must be at least ${PASSWORD_MIN} characters`
      );
    });

    it(`rejects more than ${PASSWORD_MAX} characters`, () => {
      const long = `Aa1!${"qWeRtY9#".repeat(10)}`;
      expect(long.length).toBeGreaterThan(PASSWORD_MAX);
      expect(passwordIssues(long, CONTEXT)).toContain(
        `Password must be at most ${PASSWORD_MAX} characters`
      );
    });

    it("rejects multibyte passwords past bcrypt's 72-byte limit", () => {
      // 30 four-byte emoji = 120 bytes, but only 60 JS characters, so the
      // character-count check passes and the byte check has to catch it.
      const emoji = `Aa1!${"🕌".repeat(30)}`;
      expect(emoji.length).toBeLessThanOrEqual(PASSWORD_MAX);
      expect(Buffer.byteLength(emoji, "utf8")).toBeGreaterThan(72);
      expect(passwordIssues(emoji, CONTEXT)).toContain(
        "Password is too long — please shorten it"
      );
    });
  });

  describe("input handling", () => {
    it("rejects non-string input instead of throwing", () => {
      for (const value of [undefined, null, 12345678, {}, []]) {
        expect(() => passwordIssues(value, CONTEXT)).not.toThrow();
        expect(isPasswordAcceptable(value, CONTEXT)).toBe(false);
      }
    });

    it("works without a context", () => {
      expect(isPasswordAcceptable("Tajweed#Halaqah42")).toBe(true);
      expect(isPasswordAcceptable("password")).toBe(false);
    });

    it("ignores name fragments shorter than 4 characters", () => {
      // "Ali" is too short to be a useful signal and would block far too much.
      expect(
        isPasswordAcceptable("Ali#Qamar72", { name: "Ali", email: "a@b.com" })
      ).toBe(true);
    });
  });

  describe("firstPasswordIssue", () => {
    it("returns null when the password is acceptable", () => {
      expect(firstPasswordIssue("Tajweed#Halaqah42", CONTEXT)).toBeNull();
    });

    it("returns the length problem first when several apply", () => {
      expect(firstPasswordIssue("abc", CONTEXT)).toBe(
        `Password must be at least ${PASSWORD_MIN} characters`
      );
    });
  });
});
