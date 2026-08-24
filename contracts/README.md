# Scholarship Escrow Contract

This directory contains the Stage 1 Soroban scholarship escrow contract for
issue 34. The contract stores an immutable scholarship schedule, accepts
non-custodial donor funding in a Stellar Asset Contract token, releases exact
milestone amounts after arbiter authorization, and permits pro-rata refunds
after expiry.

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

Run these commands from the repository root:

```bash
cargo fmt --manifest-path contracts/Cargo.toml -- --check
cargo test --manifest-path contracts/Cargo.toml
cargo clippy --manifest-path contracts/Cargo.toml --all-targets -- -D warnings
```

## Build

Build the contract through Cargo:

```bash
cargo build --manifest-path contracts/Cargo.toml \
  --package scholarship-escrow \
  --target wasm32v1-none \
  --release
```

The resulting WASM is written to
`contracts/target/wasm32v1-none/release/scholarship_escrow.wasm`.

The Stellar CLI can also build the workspace once it is installed:

```bash
stellar contract build --package scholarship-escrow
```

Testnet deployment, SAC wrapping for the configured USDC issuer, contract ID
configuration, and the unsigned JavaScript invocation flow are Stage 2 work.
Do not put secret keys in this repository or in application environment
variables.
