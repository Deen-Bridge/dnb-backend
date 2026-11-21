import * as StellarSdk from "@stellar/stellar-sdk";
import {
  DONATION_MEMO,
  PAYMENT_REFERENCE_LENGTH,
  PAYMENT_REFERENCE_RE,
  STELLAR_TEXT_MEMO_MAX_BYTES,
  buildPurchaseMemo,
  generatePaymentReference,
  parsePaymentMemo,
} from "../src/services/stellar/paymentReference.js";

describe("payment references (#695)", () => {
  describe("generatePaymentReference", () => {
    it("produces 22 Crockford base32 characters", () => {
      const reference = generatePaymentReference();
      expect(reference).toHaveLength(PAYMENT_REFERENCE_LENGTH);
      expect(reference).toMatch(PAYMENT_REFERENCE_RE);
      // Crockford drops the visually ambiguous letters.
      expect(reference).not.toMatch(/[ILOU]/);
    });

    it("does not repeat across a large sample", () => {
      const sample = new Set(Array.from({ length: 20000 }, generatePaymentReference));
      expect(sample.size).toBe(20000);
    });
  });

  describe("buildPurchaseMemo", () => {
    it("fits a Stellar text memo exactly and is accepted by the SDK", () => {
      for (const itemType of ["book", "course"]) {
        const memo = buildPurchaseMemo(itemType, generatePaymentReference());
        expect(Buffer.byteLength(memo, "utf8")).toBe(STELLAR_TEXT_MEMO_MAX_BYTES);
        expect(() => StellarSdk.Memo.text(memo)).not.toThrow();
      }
    });

    it("tags the item type", () => {
      const reference = generatePaymentReference();
      expect(buildPurchaseMemo("book", reference)).toBe(`DNB-B-${reference}`);
      expect(buildPurchaseMemo("course", reference)).toBe(`DNB-C-${reference}`);
    });

    it("refuses unknown item types and malformed references", () => {
      const reference = generatePaymentReference();
      expect(() => buildPurchaseMemo("reel", reference)).toThrow(/item type/);
      expect(() => buildPurchaseMemo("book", "abc")).toThrow(/malformed/);
      expect(() => buildPurchaseMemo("book", reference.toLowerCase())).toThrow(/malformed/);
      expect(() => buildPurchaseMemo("book", undefined)).toThrow(/malformed/);
    });
  });

  describe("parsePaymentMemo", () => {
    it("round-trips canonical memos", () => {
      const reference = generatePaymentReference();
      expect(parsePaymentMemo(buildPurchaseMemo("course", reference))).toEqual({
        kind: "canonical",
        itemType: "course",
        reference,
      });
    });

    it("recognises the donation memo", () => {
      expect(parsePaymentMemo(DONATION_MEMO)).toEqual({ kind: "donation" });
    });

    it("normalises legacy suffix memos to the stored lower-case form", () => {
      expect(parsePaymentMemo("DNB-BOOK-ABCD1234")).toEqual({
        kind: "legacy",
        itemType: "book",
        memo: "DNB-BOOK-abcd1234",
      });
      expect(parsePaymentMemo("DNB-COURSE-0f0f0f0f")).toEqual({
        kind: "legacy",
        itemType: "course",
        memo: "DNB-COURSE-0f0f0f0f",
      });
    });

    it.each([
      ["truncated canonical", "DNB-B-ABC"],
      ["lower-case canonical", `DNB-B-${"a".repeat(22)}`],
      ["excluded letter", `DNB-C-${"U".repeat(22)}`],
      ["unknown tag body", "DNB-B-"],
      ["legacy with non-hex", "DNB-BOOK-zzzzzzzz"],
      ["legacy too long", "DNB-COURSE-1234567890"],
      ["legacy too short", "DNB-BOOK-1234"],
    ])("flags %s as malformed", (_label, memo) => {
      expect(parsePaymentMemo(memo)).toEqual({ kind: "malformed" });
    });

    it.each([null, undefined, "", 42, "DNB-GIFT-12345678", "DNB-PAYOUT-abc", "hello"])(
      "treats %p as carrying no reference",
      (memo) => {
        expect(parsePaymentMemo(memo)).toEqual({ kind: "none" });
      }
    );
  });
});
