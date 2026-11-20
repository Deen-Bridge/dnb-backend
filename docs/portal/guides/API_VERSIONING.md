# API Versioning Guide

## Overview

DeenBridge uses **URL-prefix versioning**. Every endpoint is available under a versioned path:

| Prefix | Meaning |
|--------|---------|
| `/api/v1/` | Version 1 (current stable) |
| `/api/v2/` | Version 2 (planned breaking changes) |
| `/api/`    | Defaults to latest stable (currently v1) |

The supported-version contract is deliberately explicit:

| Version | Status | Breaking changes | Support policy |
|---------|--------|------------------|----------------|
| v1 | Stable | No | Supported for at least six months after a replacement reaches GA |
| v2 | Compatibility | Yes, when a route is explicitly promoted | New breaking behavior must be implemented in a v2-owned route |

Every versioned response includes `X-API-Version` and `X-API-Stability`. Set
`API_V1_SUNSET_DATE=YYYY-MM-DD` only after a reviewed deprecation decision;
v1 responses will then also include `Deprecation: true`, `Sunset`, and a
deprecation link. The environment variable is intentionally opt-in so a
deployment cannot accidentally announce a sunset.

## Why versioning?

Versioning allows us to ship breaking changes (renamed fields, new required parameters, changed response shapes) without forcing every client to upgrade immediately.

## How to target a specific version

Prefix your API calls with the desired version:

```
# v1 (current stable)
GET https://api.deenbridge.io/api/v1/reels

# v2 (future)
GET https://api.deenbridge.io/api/v2/reels
```

## Migration from `/api/` to `/api/v1/`

No changes required — `/api/` still works and resolves to v1.  We recommend updating client base URLs to `/api/v1/` now so you can easily switch to `/api/v2/` when it introduces features you need.

## Breaking change policy

| Change type | Version bump? |
|-------------|---------------|
| New optional field in response | No |
| New optional query parameter | No |
| Renamed field | Yes — new endpoint in v2 |
| Removed field | Yes — new endpoint in v2 |
| Changed HTTP method | Yes — new endpoint in v2 |
| New required request field | Yes — new endpoint in v2 |

Breaking-change checklist:

1. Record the decision and owner in the release notes.
2. Add or change the handler under `src/routes/api/v2/`; shared behavior must
   remain in a version-neutral service with explicit response schemas.
3. Add contract tests for the affected route under both `/api/v1/` and
   `/api/v2/`, including the compatibility response and version headers.
4. Publish a migration notice and verify the rollback target before release.

## Deprecation timeline

When a v2 version of an endpoint is ready:

1. The v1 version is marked **deprecated** in the OpenAPI spec.
2. A `Sunset` header is added to responses for that endpoint.
3. v1 support continues for at least **6 months** after the v2 GA date.
4. v1 is removed after the sunset date.

## Current status

| Version | Status |
|---------|--------|
| v1 | ✅ Stable |
| v2 | 🚧 Infrastructure ready, no breaking changes yet |
