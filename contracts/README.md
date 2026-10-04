# Soroban Contracts

This workspace contains the Soroban scholarship escrow contract. It records
an immutable milestone schedule, accepts donor-authorized funding in a Stellar
Asset Contract token, releases milestone amounts after arbiter authorization,
and permits pro-rata refunds after expiry. The escrow contract is not yet wired
into the application's sadaqah donation flow; that flow currently sends a
classic Stellar payment to the configured donation wallet.

## Local Setup

Install Rust with `rustup`, then install the target used by current Soroban
tooling:

```bash
rustup target add wasm32v1-none
```

Install the Stellar CLI using the official Stellar CLI instructions. Check the
local toolchain before building:

```bash
rustc --version
cargo --version
stellar --version
```

## Test and Format

Run these commands from this directory (`dnb-backend/contracts/`):

```bash
cargo fmt -- --check
cargo test
cargo clippy --all-targets -- -D warnings
```

## Build

Build the contract through Cargo:

```bash
cargo build --package scholarship-escrow \
  --target wasm32v1-none \
  --release
```

The resulting WASM is written to `target/wasm32v1-none/release/scholarship_escrow.wasm`.

## Testnet deployment

Create and fund a testnet deployment identity with the Stellar CLI. Then set
`STELLAR_SOURCE_ACCOUNT` to its local CLI alias (never a secret key) and run:

```bash
./scripts/deploy-scholarship-escrow-testnet.sh
```

The script always targets testnet and prints the contract ID. Save that public
ID as `GIVING_ESCROW_CONTRACT_ID` only in the matching testnet deployment
environment. Deployment installs the contract code; it does not initialize an
escrow. A campaign needs a USDC Stellar Asset Contract address, arbiter,
beneficiary, milestone schedule, and expiry ledger. For a testnet campaign,
set the corresponding `SCHOLARSHIP_*` values and run:

```bash
./scripts/initialize-scholarship-escrow-testnet.sh
```

`SCHOLARSHIP_MILESTONES_JSON` is a JSON array such as
`[{"amount":"100000000","released":false}]`; amounts use seven-decimal USDC
base units, so this example represents 10 USDC. The CLI identity must be the
arbiter account and must be funded on testnet.

The backend API and dashboard can prepare wallet-signed contributions,
milestone releases, and refunds for the single contract ID configured in
`SCHOLARSHIP_ESCROW_CONTRACT_ID`. Deploy and initialize a separate contract
instance for each campaign; the current UI supports the one campaign configured
in the active deployment. The campaign contract ID and RPC URL must use the
same network as `STELLAR_NETWORK` and `NEXT_PUBLIC_STELLAR_NETWORK`.

### Mainnet deployment

Do not run the mainnet scripts until the contract has passed testnet contract
and application-flow checks and the campaign terms have been reviewed. The
scripts require explicit network and confirmation values; the deployer and
arbiter aliases refer to local Stellar CLI identities, never key material
copied into this repository.

Build and deploy the contract code:

```bash
STELLAR_NETWORK=mainnet \
CONFIRM_STELLAR_MAINNET_DEPLOY=DEPLOY_SCHOLARSHIP_ESCROW_TO_MAINNET \
STELLAR_SOURCE_ACCOUNT=mainnet-deployer \
./scripts/deploy-scholarship-escrow-mainnet.sh
```

Derive the mainnet Circle USDC SAC address, then initialize a fresh contract
instance with the verified beneficiary, arbiter, milestones, and expiry ledger:

```bash
stellar contract id asset \
  --asset USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN \
  --network mainnet

STELLAR_NETWORK=mainnet \
CONFIRM_STELLAR_MAINNET_INIT=INITIALIZE_SCHOLARSHIP_ESCROW_ON_MAINNET \
STELLAR_ARBITER_ACCOUNT=mainnet-arbiter \
SCHOLARSHIP_ARBITER_ADDRESS=G... \
SCHOLARSHIP_BENEFICIARY_ADDRESS=G... \
SCHOLARSHIP_USDC_SAC_ADDRESS=C... \
SCHOLARSHIP_MILESTONES_JSON='[{"amount":"100000000","released":false}]' \
SCHOLARSHIP_EXPIRY_LEDGER=<future-ledger-sequence> \
SCHOLARSHIP_ESCROW_CONTRACT_ID=C... \
./scripts/initialize-scholarship-escrow-mainnet.sh
```

The example milestone is 10 USDC; replace all placeholders with campaign
values that have been approved. Set the resulting contract ID and the trusted
mainnet RPC URL in the backend deployment, and set
`NEXT_PUBLIC_STELLAR_NETWORK=mainnet` in the frontend. Never reuse a testnet
contract or SAC address. Verify the initialized state on mainnet before showing
the scholarship as open for contributions.

### Soroban storage upkeep

The escrow renews its contract, shared state, milestone schedule, and active
donor records when called. Soroban entries still have a finite maximum TTL, so
a quiet campaign needs a maintainer to call `maintain_ttl` before entries
archive. Run it at least every two weeks during an active campaign. Process
donor batches starting at index `0`, then use each returned cursor as the next
`start_index`, until the method returns `0`. The call is permissionless, but
the submitting account pays network and storage fees. Fund that account with a
modest XLM reserve and monitor successful renewals; a dashboard state read
does not renew TTL because read simulations do not write to the ledger.

Version 1 caps a campaign at 256 donors, 100 milestones, and 100 billion USDC
total. These bounds keep refund accounting and TTL maintenance within explicit
arithmetic and resource limits. If a campaign needs more, review and upgrade
the contract before accepting contributions.

Before enabling a mainnet campaign, deploy and exercise the full flow on
testnet, review the contract's authorization and refund policy, and configure
a trusted Soroban RPC provider. Never put secret keys in this repository or
in application environment variables.
