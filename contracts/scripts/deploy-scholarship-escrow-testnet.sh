#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
contracts_dir="$(cd -- "$script_dir/.." && pwd)"
wasm_path="$contracts_dir/target/wasm32v1-none/release/scholarship_escrow.wasm"

if [[ -z "${STELLAR_SOURCE_ACCOUNT:-}" ]]; then
  echo "Set STELLAR_SOURCE_ACCOUNT to a funded Stellar CLI testnet identity alias." >&2
  exit 2
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required. Install it before deploying." >&2
  exit 2
fi

if [[ "${STELLAR_NETWORK:-testnet}" != "testnet" ]]; then
  echo "This script is testnet-only; unset STELLAR_NETWORK or set it to testnet." >&2
  exit 2
fi

cd "$contracts_dir"
cargo build --package scholarship-escrow --target wasm32v1-none --release

contract_alias="${SCHOLARSHIP_ESCROW_ALIAS:-deenbridge-scholarship-escrow-testnet-$(date -u +%Y%m%d%H%M%S)}"
echo "Deploying scholarship-escrow WASM to Stellar testnet using CLI identity: $STELLAR_SOURCE_ACCOUNT"
echo "Local contract alias: $contract_alias"
stellar contract deploy \
  --wasm "$wasm_path" \
  --source-account "$STELLAR_SOURCE_ACCOUNT" \
  --network testnet \
  --alias "$contract_alias"
