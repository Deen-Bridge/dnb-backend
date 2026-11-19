import {
  isAllowedMediaUrl,
  parseByteRange,
  safeMediaFilename,
} from "../src/utils/mediaDownloadSecurity.js";

describe("media download security helpers", () => {
  test("accepts only bounded explicit byte ranges", () => {
    expect(parseByteRange("bytes=0-1023", 1024)).toEqual({
      start: 0,
      end: 1023,
      header: "bytes=0-1023",
    });
    expect(parseByteRange("bytes=0-1024", 1024)).toBeNull();
    expect(parseByteRange("bytes=0-", 1024)).toBeNull();
  });

  test("removes path and header injection characters from filenames", () => {
    expect(safeMediaFilename("../book\"\r\n.pdf")).toBe("..book.pdf");
  });

  test("rejects unconfigured and non-HTTPS media URLs", () => {
    delete process.env.MEDIA_ALLOWED_HOSTS;
    delete process.env.CLOUDINARY_CLOUD_NAME;
    expect(isAllowedMediaUrl("http://cdn.example.test/book.pdf")).toBe(false);
    expect(isAllowedMediaUrl("https://cdn.example.test/book.pdf")).toBe(false);
  });
});
