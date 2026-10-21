#!/usr/bin/env bash
# scripts/generate-docs.sh — Issue #224
#
# Generate / validate the developer documentation portal.
#
# Usage:
#   ./scripts/generate-docs.sh             # validate + bundle
#   ./scripts/generate-docs.sh --serve     # validate + serve locally on :8080
#
# Requirements (install via npm install --save-dev):
#   - @redocly/cli  — spec linting + bundling
#
# The portal itself is a static HTML file (docs/portal/index.html) that
# loads Redoc from CDN and fetches openapi.yaml via the /docs/spec endpoint
# at runtime, so no separate build step is required for deployment.
# This script is useful for offline validation and CI checks.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SPEC="$REPO_ROOT/openapi.yaml"
PORTAL_DIR="$REPO_ROOT/docs/portal"
BUNDLE_OUT="$PORTAL_DIR/openapi.bundle.yaml"

echo "==> DeenBridge API documentation generator"
echo "    spec       : $SPEC"
echo "    portal     : $PORTAL_DIR"

# -----------------------------------------------------------------------
# 1. Validate openapi.yaml
# -----------------------------------------------------------------------
echo ""
echo "==> Validating OpenAPI spec..."
if command -v redocly &>/dev/null; then
  redocly lint "$SPEC"
  echo "    ✓ Spec is valid"
else
  echo "    ⚠  redocly CLI not found — skipping lint (npm install -g @redocly/cli)"
fi

# -----------------------------------------------------------------------
# 2. Bundle (resolve $ref cross-references) → single file
# -----------------------------------------------------------------------
echo ""
echo "==> Bundling spec to $BUNDLE_OUT..."
if command -v redocly &>/dev/null; then
  redocly bundle "$SPEC" --output "$BUNDLE_OUT"
  echo "    ✓ Bundle written to $BUNDLE_OUT"
else
  echo "    ⚠  Skipping bundle (redocly CLI not found)"
fi

# -----------------------------------------------------------------------
# 3. Optional: serve locally for preview
# -----------------------------------------------------------------------
if [[ "${1:-}" == "--serve" ]]; then
  echo ""
  echo "==> Serving docs at http://localhost:8080 ..."
  if command -v redocly &>/dev/null; then
    redocly preview-docs "$SPEC" --port 8080
  else
    echo "    ✗  redocly CLI required for --serve: npm install -g @redocly/cli"
    exit 1
  fi
fi

echo ""
echo "==> Done. Deploy the /docs/portal directory or start the API server"
echo "    and navigate to http://localhost:<PORT>/docs"
