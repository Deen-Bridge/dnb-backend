# Media download security

All media download and stream handlers must authorize access before reading a
storage record or making an outbound request. Object identifiers and complete
URLs supplied by clients are never accepted as storage paths.

The book preview and audiobook fallback handlers now enforce the shared policy:

- only HTTPS storage URLs on `MEDIA_ALLOWED_HOSTS` (comma-separated) or the
  configured Cloudinary host are eligible for proxying;
- explicit byte ranges are required to have numeric start and end offsets and
  are capped at 10 MiB per request; open-ended and oversized ranges are rejected;
- signed Cloudinary redirects remain short-lived and object-specific;
- proxied responses use private no-store caching, safe content headers, and a
  sanitized filename;
- certificate downloads require the certificate owner or an authenticated
  administrator, while public certificate verification remains separate.

When adding a new media route, document its entitlement rule, storage provider,
maximum transfer/range, revocation behavior, and IDOR/range/replay tests. Roll
out new indexes or storage-policy changes behind the normal deployment gate and
retain the prior configuration for rollback.
