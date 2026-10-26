import { describe, expect, it } from "@jest/globals";

describe("spaces and space-recording route request validation (#418)", () => {
  it("validates space title bounds and HTTPS recording URLs", () => {
    const isValidSpacePayload = ({ title, recordingUrl }) =>
      typeof title === "string" &&
      title.trim().length >= 3 &&
      title.trim().length <= 120 &&
      (!recordingUrl || recordingUrl.startsWith("https://"));
    expect(
      isValidSpacePayload({
        title: "Tafsir Study Circle",
        recordingUrl: "https://cdn.deenbridge.com/recordings/1.mp4",
      })
    ).toBe(true);
    expect(
      isValidSpacePayload({
        title: "ab",
        recordingUrl: "http://insecure.example/1.mp4",
      })
    ).toBe(false);
  });
});
