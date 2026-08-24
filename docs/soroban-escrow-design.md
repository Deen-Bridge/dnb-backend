# Scholarship Escrow Design

## Scope

This document defines the Stage 1 Soroban contract for a scholarship escrow. The
contract holds a Stellar Asset Contract (SAC) representation of the scholarship
asset. It does not custody private keys, create wallets, or perform classic
Stellar payments. The later JavaScript and API stages will build unsigned
Soroban invocation transactions around this contract.

All monetary values are integer `i128` values in the token's smallest unit.
For the USDC integration that unit is a stroop-like seven-decimal unit, matching
the existing JavaScript `toStroops` discipline. The contract never parses
decimal strings and never uses floating point arithmetic.

## Roles

| Role | Responsibility |
| --- | --- |
| Donor | Any address that funds the escrow. A donor authorizes each `fund` call and can claim its recorded share after expiry. |
| Beneficiary | The fixed address receiving an approved milestone amount. |
| Arbiter | The fixed platform maintainer address that authorizes milestone releases. The arbiter is trusted to approve only completed work. |
| SAC token | The fixed Stellar Asset Contract address that receives deposits and sends releases and refunds. |

The arbiter is a deliberate v1 trust assumption. A malicious or compromised
arbiter can release funded milestones early, although it cannot change the
beneficiary, token, milestone amounts, or expiry after initialization. A future
version should replace the single arbiter with a threshold authorization policy,
such as two of three independent maintainers or a Soroban multisignature
account, and should publish the policy in the escrow state.

## State Machine

```text
Uninitialized
    | init(arbiter, beneficiary, token, milestones, expiry)
    v
Active
    | fund(donor, amount)             | approve_milestone(index)
    |                                 v
    |                          Active with released milestones
    |
    | ledger sequence reaches expiry
    v
Expired
    | refund(donor)
    v
Refundable claims settled
```

Initialization is one time only and requires authorization from the supplied
arbiter. The milestone vector is copied into contract storage and cannot be
changed. Every amount must be positive and the sum of all milestones must fit
in `i128`.

While active:

- Funding requires donor authorization, moves SAC tokens from the donor to the
  contract, records the donor's cumulative contribution, and rejects funding
  that would exceed the fixed milestone total.
- Approval requires arbiter authorization, marks one unreleased milestone, and
  transfers exactly that milestone amount from the contract to the beneficiary.
- Funding and approvals are rejected once the expiry ledger is reached.
- A milestone cannot be approved twice and cannot be approved until the escrow
  has enough unreleased tokens to pay its exact amount.

After expiry, the escrow is frozen. The first valid refund snapshots the
unreleased balance. Each donor can claim once, and its claim is based on the
ratio of its contribution to total funding. Integer division rounds down for
ordinary claims; the final unclaimed donor receives the remaining snapshot
balance, including any rounding remainder. This keeps all available tokens
claimable without introducing floating point arithmetic. A donor must
authorize its own refund.

## Storage and Events

The contract stores:

- fixed role and token addresses, expiry, milestone total, and accounting totals;
- the immutable milestone vector;
- the list of donor addresses;
- each donor's cumulative contribution, refund amount, and claim status.

The `Initialized`, `Funded`, `MilestoneApproved`, and `Refunded` events expose
every state-changing operation. Donor, milestone index, and beneficiary-facing
amounts are included so an indexer can reconstruct the state without trusting
the application database.

## Invariants

The contract maintains these invariants atomically:

1. `funded_total <= milestone_total`.
2. `released_total + refunded_total <= funded_total`.
3. Each milestone is either unreleased or released exactly once.
4. A released milestone's transfer amount equals its immutable amount.
5. `refund_pool`, once created, equals the unreleased balance at expiry.
6. A donor's refund claim can be executed at most once and is authorized by that
   donor.
7. The contract's accounted SAC balance equals the funded amount less released
   and refunded amounts, assuming the token contract itself is correct.

## Threat Analysis

### Unauthorized release or refund

`approve_milestone` calls `require_auth` on the stored arbiter. `fund` and
`refund` call `require_auth` on the supplied donor. The supplied donor is not a
database identity; Soroban authorization is the security boundary.

### Reinitialization and parameter mutation

Initialization checks for existing state. There are no setters for the arbiter,
beneficiary, token, expiry, or milestone vector, so later calls cannot replace
the payout destination or release schedule.

### Over-release and accounting drift

The contract checks the milestone release flag and available balance before
calling the SAC. It updates accounting only in the same transaction as the
token transfer, so a failed transfer rolls back the state change. All arithmetic
uses checked `i128` operations.

### Funding after expiry

The expiry check runs before donor authorization and token transfer. This
freezes the funding population before the refund pool is calculated and avoids
late donors changing existing pro-rata shares.

### Token mismatch or malicious token contract

The contract accepts one token address at initialization and uses it for every
transfer. It cannot prove that an arbitrary address is the intended USDC SAC;
deployment and Stage 2 configuration must therefore pin the network, SAC
address, issuer, and asset code. A future version may verify a known SAC
registry or store the expected asset metadata alongside the address.

Anyone can transfer the configured SAC token directly to the contract without
calling `fund`. Such tokens are not donor contributions and are intentionally
excluded from release and refund accounting. Integrations must invoke `fund`
rather than treating the raw contract token balance as funded scholarship
value.

### Arbiter compromise

The single arbiter can release a milestone without an off-chain progress
agreement. This is the principal v1 trust tradeoff. The beneficiary and donors
can observe the events and balances, but cannot veto a release. Threshold
arbiter authorization is the planned mitigation.

### Refund rounding

Pro-rata claims use integer division. The final unclaimed donor receives the
remaining snapshot balance, so rounding dust is not trapped in the contract.
Claims are still order-sensitive by at most the integer remainder; Stage 2
should present the snapshot and claim status clearly to donors.

### Denial of service

Milestones are fixed and refunds are per donor. The donor list grows with the
number of distinct funders, so deployment should set practical funding and
resource limits. A future version can use a separate claim registry or Merkle
distribution if scholarship escrows need very large donor sets.

## Stage Boundaries

This Stage 1 change intentionally stops at the design and contract foundation.
Stage 2 must review this state machine before adding the Soroban RPC service,
SAC deployment, and wallet signing walkthrough. Stage 3 can then add API
endpoints, transaction persistence, and live state reconciliation without
changing the contract's trust model.
