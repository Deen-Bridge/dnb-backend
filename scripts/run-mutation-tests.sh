#!/usr/bin/env bash
set -euo pipefail

echo "Starting mutation tests..."

# Ensure dependencies are available or install if needed
if [ ! -d "node_modules/@stryker-mutator" ]; then
  echo "Installing Stryker packages..."
  npm install --no-save @stryker-mutator/core @stryker-mutator/jest-runner
fi

NODE_ENV=test npx stryker run
