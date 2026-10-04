#!/usr/bin/env bash
set -euo pipefail

required_vars=(
  STELLAR_ARBITER_ACCOUNT
  SCHOLARSHIP_ARBITER_ADDRESS
  SCHOLARSHIP_BENEFICIARY_ADDRESS
  SCHOLARSHIP_USDC_SAC_ADDRESS
  SCHOLARSHIP_MILESTONES_JSON
  SCHOLARSHIP_EXPIRY_LEDGER
  SCHOLARSHIP_ESCROW_CONTRACT_ID
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Set $var_name before initializing the testnet escrow." >&2
    exit 2
  fi
done

if [[ "${STELLAR_NETWORK:-testnet}" != "testnet" ]]; then
  echo "This script is testnet-only; unset STELLAR_NETWORK or set it to testnet." >&2
  exit 2
fi

if ! command -v stellar >/dev/null 2>&1; then
  echo "Stellar CLI is required. Install it before initializing the escrow." >&2
  exit 2
fi

if [[ ! "$SCHOLARSHIP_EXPIRY_LEDGER" =~ ^[0-9]+$ ]]; then
  echo "SCHOLARSHIP_EXPIRY_LEDGER must be a future ledger sequence number." >&2
  exit 2
fi

signer_address="$(stellar keys address "$STELLAR_ARBITER_ACCOUNT")"
if [[ "$signer_address" != "$SCHOLARSHIP_ARBITER_ADDRESS" ]]; then
  echo "The CLI signer address must match SCHOLARSHIP_ARBITER_ADDRESS." >&2
  exit 2
fi

echo "Initializing scholarship escrow on testnet. The arbiter identity will authorize this transaction."
stellar contract invoke \
  --id "$SCHOLARSHIP_ESCROW_CONTRACT_ID" \
  --source-account "$STELLAR_ARBITER_ACCOUNT" \
  --network testnet \
  -- \
  init \
  --arbiter "$SCHOLARSHIP_ARBITER_ADDRESS" \
  --beneficiary "$SCHOLARSHIP_BENEFICIARY_ADDRESS" \
  --token "$SCHOLARSHIP_USDC_SAC_ADDRESS" \
  --milestones "$SCHOLARSHIP_MILESTONES_JSON" \
  --expiry "$SCHOLARSHIP_EXPIRY_LEDGER"
