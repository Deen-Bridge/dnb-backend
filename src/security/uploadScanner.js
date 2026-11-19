import { createHash } from "node:crypto";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

/**
 * Scan an upload while it is still private. The scanner command must accept a
 * file path and return exit code 0 for clean content. Shell execution is
 * deliberately disabled so filenames and content cannot become commands.
 */
export async function scanUpload({ buffer, originalName = "upload", mimeType = "application/octet-stream" }) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new UploadSecurityError("EMPTY_UPLOAD", "Upload is empty");
  }
  if (buffer.length > MAX_UPLOAD_BYTES) {
    throw new UploadSecurityError("UPLOAD_TOO_LARGE", "Upload exceeds the server limit");
  }

  const hash = createHash("sha256").update(buffer).digest("hex");
  const scanner = process.env.UPLOAD_SCANNER_COMMAND || "clamdscan";
  const timeout = Number(process.env.UPLOAD_SCANNER_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  const dir = await mkdtemp(join(tmpdir(), "dnb-upload-quarantine-"));
  const safeName = String(originalName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "upload";
  const path = join(dir, safeName);

  try {
    await writeFile(path, buffer, { mode: 0o600, flag: "wx" });
    let result;
    try {
      result = await execFileAsync(scanner, ["--no-summary", path], {
        timeout,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      });
    } catch (error) {
      if (/FOUND\s*$/im.test(`${error.stdout || ""}\n${error.stderr || ""}`)) {
        throw new UploadSecurityError("MALWARE_DETECTED", "Upload failed malware scanning");
      }
      throw new UploadSecurityError(
        error.killed || error.signal === "SIGTERM" ? "SCANNER_TIMEOUT" : "SCANNER_UNAVAILABLE",
        "Upload scanner did not provide a clean verdict",
        { cause: error }
      );
    }

    if (result.stdout && /FOUND\s*$/im.test(result.stdout)) {
      throw new UploadSecurityError("MALWARE_DETECTED", "Upload failed malware scanning");
    }

    return {
      verdict: "clean",
      engine: scanner,
      engineVersion: process.env.UPLOAD_SCANNER_VERSION || "configured",
      sha256: hash,
      mimeType,
    };
  } finally {
    await unlink(path).catch(() => {});
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

export class UploadSecurityError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "UploadSecurityError";
    this.code = code;
  }
}

export const uploadScannerLimits = { maxBytes: MAX_UPLOAD_BYTES };
