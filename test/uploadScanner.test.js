import { jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const nodeRequire = createRequire(import.meta.url);
const mockExecFileAsync = jest.fn();

jest.unstable_mockModule("node:child_process", () => ({ execFile: jest.fn() }));
jest.unstable_mockModule("node:util", () => ({
  ...nodeRequire("node:util"),
  promisify: () => mockExecFileAsync,
}));

const { scanUpload, UploadSecurityError, uploadScannerLimits } = await import(
  "../src/security/uploadScanner.js"
);

const buffer = Buffer.from("clean content");
const expectedHash = createHash("sha256").update(buffer).digest("hex");

const setScannerResult = ({ stdout = "", stderr = "", error } = {}) => {
  if (error) mockExecFileAsync.mockRejectedValue(error);
  else mockExecFileAsync.mockResolvedValue({ stdout, stderr });
};

beforeEach(() => {
  jest.resetAllMocks();
  process.env.UPLOAD_SCANNER_COMMAND = "mock-scanner";
  process.env.UPLOAD_SCANNER_VERSION = "1.2.3";
  delete process.env.UPLOAD_SCANNER_TIMEOUT_MS;
  setScannerResult({ stdout: "/tmp/quarantine/book.pdf: OK\n" });
});

afterEach(() => {
  delete process.env.UPLOAD_SCANNER_COMMAND;
  delete process.env.UPLOAD_SCANNER_VERSION;
  delete process.env.UPLOAD_SCANNER_TIMEOUT_MS;
});

describe("scanUpload", () => {
  it("returns a clean verdict with hash, engine, version and MIME metadata", async () => {
    const result = await scanUpload({
      buffer,
      originalName: "book.pdf",
      mimeType: "application/pdf",
    });

    expect(result).toEqual({
      verdict: "clean",
      engine: "mock-scanner",
      engineVersion: "1.2.3",
      sha256: expectedHash,
      mimeType: "application/pdf",
    });
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      "mock-scanner",
      ["--no-summary", expect.stringContaining("book.pdf")],
      expect.objectContaining({ timeout: 15000 })
    );
  });

  it("fails closed when the scanner exits with a FOUND verdict", async () => {
    setScannerResult({
      error: Object.assign(new Error("scan failed"), {
        stdout: "/tmp/quarantine/book.pdf: Eicar-Test-Signature FOUND\n",
      }),
    });

    await expect(scanUpload({ buffer })).rejects.toBeInstanceOf(UploadSecurityError);
    await expect(scanUpload({ buffer })).rejects.toMatchObject({ code: "MALWARE_DETECTED" });
  });

  it("fails closed when a clean exit still reports FOUND", async () => {
    setScannerResult({ stdout: "/tmp/quarantine/book.pdf: Eicar-Test-Signature FOUND\n" });

    await expect(scanUpload({ buffer })).rejects.toMatchObject({ code: "MALWARE_DETECTED" });
  });

  it("fails closed when the scanner cannot provide a verdict", async () => {
    setScannerResult({ error: new Error("spawn mock-scanner ENOENT") });

    await expect(scanUpload({ buffer })).rejects.toMatchObject({ code: "SCANNER_UNAVAILABLE" });
  });

  it("reports scanner timeouts", async () => {
    setScannerResult({ error: Object.assign(new Error("timed out"), { killed: true }) });

    await expect(scanUpload({ buffer })).rejects.toMatchObject({ code: "SCANNER_TIMEOUT" });
  });

  it("rejects empty uploads and uploads over the server limit", async () => {
    await expect(scanUpload({ buffer: Buffer.alloc(0) })).rejects.toMatchObject({
      code: "EMPTY_UPLOAD",
    });
    await expect(scanUpload({ buffer: Buffer.alloc(uploadScannerLimits.maxBytes + 1) })).rejects.toMatchObject({
      code: "UPLOAD_TOO_LARGE",
    });
    expect(mockExecFileAsync).not.toHaveBeenCalled();
  });
});
