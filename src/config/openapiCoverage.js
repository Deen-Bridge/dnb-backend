export function listDocumentedPaths(spec = {}) { return Object.keys(spec.paths || {}).sort(); }
export function hasDocumentedPath(spec, path) { return Boolean(spec?.paths?.[path]); }
