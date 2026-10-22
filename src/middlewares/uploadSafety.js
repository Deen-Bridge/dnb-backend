const CONTROL = /[\u0000-\u001f\u007f]/;
export function isSafeUploadName(name = "") {
  const normalized = String(name).replaceAll("\\", "/");
  return normalized.length > 0 && normalized !== "." && normalized !== ".." && !normalized.includes("../") && !normalized.includes("/..") && !CONTROL.test(normalized);
}
