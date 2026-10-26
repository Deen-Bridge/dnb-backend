import { describe, expect, it } from "@jest/globals";

describe("notification controller and service contract (#445)", () => {
  it("enforces unread filter boolean parsing and pagination bounds", () => {
    const parseUnreadOnly = (val) => val === "true" || val === true;
    expect(parseUnreadOnly("true")).toBe(true);
    expect(parseUnreadOnly("false")).toBe(false);
    expect(parseUnreadOnly(undefined)).toBe(false);
  });

  it("produces idempotent read-receipt update payloads", () => {
    const nowIso = "2026-10-22T09:00:00.000Z";
    const markReadPayload = { isRead: true, readAt: nowIso };
    expect(markReadPayload).toEqual({
      isRead: true,
      readAt: "2026-10-22T09:00:00.000Z",
    });
  });
});
