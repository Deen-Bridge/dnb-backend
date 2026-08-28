# API Versioning Guide

## Overview

DeenBridge uses **URL-prefix versioning**. Every endpoint is available under a versioned path:

| Prefix | Meaning |
|--------|---------|
| `/api/v1/` | Version 1 (current stable) |
| `/api/v2/` | Version 2 (planned breaking changes) |
| `/api/`    | Defaults to latest stable (currently v1) |

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
