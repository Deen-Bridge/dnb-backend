#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OPENAPI_FILE="$ROOT_DIR/openapi.yaml"
SDK_DIR="$ROOT_DIR/sdk"
GENERATOR_VERSION="7.12.0"

if ! command -v docker &>/dev/null; then
  echo "Error: docker is required to run openapi-generator-cli" >&2
  exit 1
fi

if [ ! -f "$OPENAPI_FILE" ]; then
  echo "Error: openapi.yaml not found at $OPENAPI_FILE" >&2
  exit 1
fi

echo "Generating TypeScript-fetch SDK..."

docker run --rm \
  -v "$ROOT_DIR:/workspace" \
  openapitools/openapi-generator-cli:v${GENERATOR_VERSION} generate \
  -i /workspace/openapi.yaml \
  -g typescript-fetch \
  -o /workspace/sdk/src \
  --additional-properties=supportsES6=true,npmVersion=1.0.0,typescriptThreePlus=true \
  --git-user-id Deen-Bridge \
  --git-repo-id dnb-sdk

echo "SDK generated in $SDK_DIR/src"
