#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
contracts_dir="$(cd -- "$script_dir/.." && pwd)"
wasm_path="$contracts_dir/target/wasm32v1-none/release/scholarship_escrow.wasm"

if [[ "${STELLAR_NETWORK:-}" != "mainnet" ]]; then
  echo "Set STELLAR_NETWORK=mainnet explicitly before using this script." >&2
  exit 2
fi
if [[ "${CONFIRM_STELLAR_MAINNET_DEPLOY:-}" != "DEPLOY_SCHOLARSHIP_ESCROW_TO_MAINNET" ]]; then
  echo "Set CONFIRM_STELLAR_MAINNET_DEPLOY=DEPLOY_SCHOLARSHIP_ESCROW_TO_MAINNET to confirm the mainnet deployment." >&2
  exit 2
fi
if [[ -z "${STELLAR_SOURCE_ACCOUNT:-}" ]]; then
  echo "Set STELLAR_SOURCE_ACCOUNT to a funded local Stellar CLI identity alias." >&2
  exit 2
fi
if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required. Install it before deploying." >&2
  exit 2
fi

cd "$contracts_dir"
cargo build --package scholarship-escrow --target wasm32v1-none --release

contract_alias="${SCHOLARSHIP_ESCROW_ALIAS:-deenbridge-scholarship-escrow-mainnet-$(date -u +%Y%m%d%H%M%S)}"
echo "Deploying scholarship-escrow WASM to Stellar mainnet using CLI identity: $STELLAR_SOURCE_ACCOUNT"
echo "Local contract alias: $contract_alias"
stellar contract deploy \
  --wasm "$wasm_path" \
  --source-account "$STELLAR_SOURCE_ACCOUNT" \
  --network mainnet \
  --alias "$contract_alias"
