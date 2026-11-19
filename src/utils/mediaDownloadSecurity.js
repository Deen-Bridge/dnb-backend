const DEFAULT_MAX_RANGE_BYTES = 10 * 1024 * 1024;
export const MEDIA_URL_TTL_SECONDS = 10 * 60;
const STORAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9/_-]*(?:\.[A-Za-z0-9_-]+)?$/;

export function isSafeStorageId(value, { prefix } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > 255) return false;
  if (value.includes("..") || value.startsWith("/") || !STORAGE_ID_PATTERN.test(value)) return false;
  return !prefix || value.startsWith(prefix);
}

const configuredHosts = () =>
  new Set(
    (process.env.MEDIA_ALLOWED_HOSTS || "")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );

export function parseByteRange(value, maxBytes = DEFAULT_MAX_RANGE_BYTES) {
  if (value == null || value === "") return null;
  const match = /^bytes=(\d+)-(\d+)$/.exec(String(value).trim());
  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end < start) return null;
  if (end - start + 1 > maxBytes) return null;
  return { start, end, header: `bytes=${start}-${end}` };
}

export function isAllowedMediaUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const hosts = configuredHosts();
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME?.trim().toLowerCase();
  if (cloudName && url.hostname.toLowerCase() === "res.cloudinary.com") {
    const pathSegments = url.pathname.split("/").filter(Boolean).map((segment) => segment.toLowerCase());
    return pathSegments.includes(cloudName);
  }
  return hosts.has(url.hostname.toLowerCase());
}

export function safeMediaFilename(value, fallback = "download") {
  const base = String(value || fallback)
    .replace(/[\\/\r\n\0]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "")
    .trim()
    .slice(0, 120);
  return base || fallback;
}

export function setMediaHeaders(res, { contentType, disposition = "inline", filename } = {}) {
  if (contentType) res.setHeader("Content-Type", contentType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cache-Control", "private, no-store");
  if (filename) {
    const safeName = safeMediaFilename(filename);
    res.setHeader("Content-Disposition", `${disposition}; filename="${safeName}"`);
  }
}

export const MEDIA_MAX_RANGE_BYTES = DEFAULT_MAX_RANGE_BYTES;
