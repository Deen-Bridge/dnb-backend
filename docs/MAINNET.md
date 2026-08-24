# Switching DeenBridge to Stellar Mainnet (USDC)

DeenBridge runs on **Stellar testnet** by default (`STELLAR_NETWORK=testnet`).
This document is the complete checklist for moving the payment stack to
**mainnet** (the Stellar public network, `STELLAR_NETWORK=public` or
`mainnet`). Following it end-to-end means the switch requires **no code
reading** — only environment changes, wallet/trustline setup, and a smoke
test.

> ⚠️ **Config is validated at boot.** The backend validates the Stellar
> configuration at startup (see `src/config/stellar.js`). A wrong or
> incomplete configuration **fails fast** with an error naming the exact
> problem instead of failing later on the first Horizon call. If you see
> `❌ Stellar configuration error` in the logs at boot, fix the named
> variable and restart — do not ship it.

---

## 1. Understand what "network" controls

Everything network-dependent resolves from a single source of truth
(`src/config/stellar.js`):

| Setting | testnet | mainnet (`mainnet` / `public`) |
|---------|---------|-------------------------------|
| Network passphrase | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |
| Default Horizon URL | `https://horizon-testnet.stellar.org` | `https://horizon.stellar.org` |
| USDC issuer (Circle) | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |
| EURC issuer | `GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO7VTC3NM2ZTVO` | `GDHU6WRG4IEQXM5NZ4BMPKOXHW76MZM4Y2IEMFDVXBSDP6SJY4ITNPP2` |

`STELLAR_NETWORK` accepts `testnet`, `mainnet`, or `public` (`public` is the
SDF name for the production network and is treated as `mainnet`). The USDC
issuer and default Horizon URL are derived from the network — you cannot
accidentally combine a mainnet flag with a testnet issuer or Horizon URL; the
boot-time validation rejects it.

---

## 2. Backend environment variables

Change these in the backend deployment (`.env` / Render / Vercel env):

```dotenv
# The one switch that matters
STELLAR_NETWORK=mainnet        # or "public" — both mean mainnet

# Optional: explicit Horizon endpoints (comma-separated, for redundancy).
# Leave UNSET to use the network default (https://horizon.stellar.org).
# Never point a mainnet deployment at the testnet Horizon URL — boot will fail.
# HORIZON_URLS=https://horizon.stellar.org,https://horizon-fr.stellar.org

# Horizon client tuning (optional, same defaults as testnet)
# HORIZON_TIMEOUT_MS=10000
# HORIZON_MAX_RETRIES=3
# HORIZON_CB_THRESHOLD=5
# HORIZON_CB_COOLDOWN_MS=30000
```

Also confirm the platform-level keys are set for mainnet (they are
network-agnostic, but they move real money now):

```dotenv
# Platform fee wallet (receives the platform share of a fee-split purchase)
PLATFORM_WALLET_PUBLIC_KEY=G...
# Donation fund destination
DONATION_WALLET_PUBLIC_KEY=G...
# SEP-10 auth keypair public key (published in stellar.toml)
SIGNING_KEY=G...
```

### What NOT to change

- `PLATFORM_FEE_PERCENT`, `PLATFORM_COLLECT_ENABLED` — unchanged.
- The **secret keys** of user wallets are never stored on the backend
  (non-custodial). Users hold their own funds.

---

## 3. Frontend environment variables

The frontend must run on the **same network** or signatures will be rejected
(wrong network passphrase). In the `dnb-frontend` deployment set:

```dotenv
NEXT_PUBLIC_STELLAR_NETWORK=mainnet
```

This must match the backend's `STELLAR_NETWORK` **exactly**. A mismatch
(backend on mainnet, frontend on testnet) produces signatures that fail with
`op_bad_auth` / bad network passphrase on submit.

---

## 4. Creator trustlines (critical)

Creators receive USDC **directly to their own wallets** (direct settlement)
or the platform wallet receives it (platform-collect mode). For a creator to
be able to receive USDC on mainnet, their wallet **must have a USDC
trustline to the mainnet Circle issuer**:

```
USDC issuer (mainnet): GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN
```

Notes:

- A **trustline added on testnet does not carry over** to mainnet — trustlines
  are per-account and per-network. Every creator must add the mainnet USDC
  trustline even if they already had one on testnet.
- Freighter / xBull / Albedo have a "manage assets" / "add asset" flow; pasting
  the issuer above adds the trustline. This costs a small one-time XLM reserve
  (the account must also hold a bit of XLM for fees and the reserve).
- A purchase to a creator **without** the USDC trustline fails on-chain
  (`op_no_trust`). The preflight check (`POST /api/stellar/payment/preflight`)
  surfaces this before the wallet is asked to sign, and the initialize
  endpoint can return `{ fallback: "claimable_balance" }` so the buyer can
  still complete via a claimable balance instead of dead-ending.
- If the platform is in **platform-collect** mode, the platform wallet itself
  must have the mainnet USDC trustline.

### How to verify a trustline

```bash
# Replace G... with the creator's public key
curl "https://horizon.stellar.org/accounts/G..." | jq '.balances[] | select(.asset_code=="USDC")'
```

An entry with `asset_code: "USDC"` and `asset_issuer` equal to the mainnet
Circle issuer confirms the trustline exists. If the array is empty of USDC,
the creator needs to add it.

---

## 5. Smoke-test checklist (first mainnet transaction)

Run these in order, on the **mainnet deployment**, after the env changes are
live. Do not proceed past a failed step.

1. **Boot check** — start the backend. Confirm it logs
   `✅ Environment variables validated successfully` and **no**
   `❌ Stellar configuration error`. A bad `STELLAR_NETWORK` value or a
   mainnet/testnet Horizon or issuer mismatch aborts startup with the exact
   variable named.
   ```bash
   curl -s http://localhost:5000/health   # -> {"success":true,"message":"pong"}
   ```
2. **Network sanity** — confirm the app resolves mainnet:
   ```bash
   curl -s http://localhost:5000/.well-known/stellar.toml | grep -i network
   ```
   and, from the code, `NETWORK`/`networkPassphrase` resolve to
   `Public Global Stellar Network ; September 2015`.
3. **Creator trustline** — pick a test creator, confirm their mainnet USDC
   trustline via the Horizon query above. If missing, have them add it.
4. **Buyer setup** — a test buyer connects a **mainnet** wallet with a small
   amount of USDC (≥ item price) and enough XLM for fees/reserve.
5. **Preflight** — call `POST /api/stellar/payment/preflight` for a paid
   course. Expect `success: true` with no `destination_no_trustline` reason.
6. **Initialize** — `POST /api/stellar/payment/initialize` returns unsigned
   XDR + `expectedHash`. Confirm the returned `networkPassphrase` is the
   **public** passphrase.
7. **Sign & submit** — the wallet signs the XDR on mainnet;
   `POST /api/stellar/payment/submit` returns `"Payment successful!"` with a
   mainnet `stellar.expert` explorer URL.
8. **On-chain verify** — open the explorer link. Confirm a USDC payment to the
   creator (or platform) and that the buyer now owns the item
   (`GET /api/stellar/payment/transactions` shows it `confirmed`).
9. **Creator received USDC** — confirm the creator's mainnet USDC balance
   increased by the expected amount (minus platform fee if enabled).

### Rollback

To go back to testnet, revert `STELLAR_NETWORK=testnet` (backend) and
`NEXT_PUBLIC_STELLAR_NETWORK=testnet` (frontend) and redeploy. Both sides must
change together. Testnet and mainnet data (transactions, balances) are
completely separate — records created on mainnet are not visible on testnet
and vice versa.

---

## 6. Reference

- Stellar docs: [Networks](https://developers.stellar.org/docs/learn/encyclopedia/network-configuration),
  [Claimable balances](https://developers.stellar.org/docs/learn/encyclopedia/transactions-specialized/claimable-balances)
- Circle USDC: [USDC on Stellar](https://www.circle.com/en/usdc/stellar)
- Config source of truth: `src/config/stellar.js`, asset registry:
  `src/config/assets.js`
