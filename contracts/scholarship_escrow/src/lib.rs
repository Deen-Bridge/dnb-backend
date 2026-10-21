#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

// Persistent Soroban entries have a finite TTL. The maintainer refreshes the
// contract's shared entries and a bounded donor batch before entries archive.
const STORAGE_TTL_THRESHOLD: u32 = 100_000;
const STORAGE_TTL_BUMP: u32 = 500_000;
const DONOR_TTL_BATCH_SIZE: u32 = 25;
const MAX_DONORS: u32 = 256;
const MAX_MILESTONES: u32 = 100;
// Keeps contribution * refund_pool within i128 for the pro-rata calculation.
const MAX_CAMPAIGN_STROOPS: i128 = 1_000_000_000_000_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    EmptyMilestones = 2,
    InvalidExpiry = 3,
    InvalidMilestoneAmount = 4,
    InvalidMilestoneState = 5,
    MilestoneTotalOverflow = 6,
    InvalidAmount = 7,
    FundingCapExceeded = 8,
    EscrowExpired = 9,
    InvalidMilestoneIndex = 10,
    MilestoneAlreadyReleased = 11,
    InsufficientFunds = 12,
    DonorNotFound = 13,
    AlreadyRefunded = 14,
    NoRefundAvailable = 15,
    ArithmeticOverflow = 16,
    DonorLimitExceeded = 17,
    CampaignLimitExceeded = 18,
    MilestoneLimitExceeded = 19,
    ActorsMustDiffer = 20,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Milestone {
    pub amount: i128,
    pub released: bool,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowState {
    pub arbiter: Address,
    pub beneficiary: Address,
    pub token: Address,
    pub expiry: u32,
    pub milestone_total: i128,
    pub funded_total: i128,
    pub released_total: i128,
    pub refunded_total: i128,
    pub refund_pool: Option<i128>,
}

#[contracttype]
enum DataKey {
    State,
    Milestones,
    Donors,
    DonorContribution(Address),
    DonorRefund(Address),
    RefundClaimed(Address),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Initialized {
    #[topic]
    pub arbiter: Address,
    #[topic]
    pub beneficiary: Address,
    pub token: Address,
    pub expiry: u32,
    pub milestone_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Funded {
    #[topic]
    pub donor: Address,
    pub amount: i128,
    pub donor_total: i128,
    pub funded_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneApproved {
    #[topic]
    pub index: u32,
    pub amount: i128,
    pub released_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Refunded {
    #[topic]
    pub donor: Address,
    pub amount: i128,
    pub refunded_total: i128,
}

#[contract]
pub struct ScholarshipEscrow;

#[contractimpl]
impl ScholarshipEscrow {
    pub fn init(
        env: Env,
        arbiter: Address,
        beneficiary: Address,
        token: Address,
        milestones: Vec<Milestone>,
        expiry: u32,
    ) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }
        if arbiter == beneficiary {
            return Err(Error::ActorsMustDiffer);
        }

        arbiter.require_auth();

        if milestones.is_empty() {
            return Err(Error::EmptyMilestones);
        }
        if milestones.len() > MAX_MILESTONES {
            return Err(Error::MilestoneLimitExceeded);
        }
        if expiry <= env.ledger().sequence() {
            return Err(Error::InvalidExpiry);
        }

        let mut milestone_total = 0_i128;
        for milestone in milestones.iter() {
            if milestone.amount <= 0 {
                return Err(Error::InvalidMilestoneAmount);
            }
            if milestone.released {
                return Err(Error::InvalidMilestoneState);
            }
            milestone_total = milestone_total
                .checked_add(milestone.amount)
                .ok_or(Error::MilestoneTotalOverflow)?;
        }
        if milestone_total > MAX_CAMPAIGN_STROOPS {
            return Err(Error::CampaignLimitExceeded);
        }

        let state = EscrowState {
            arbiter: arbiter.clone(),
            beneficiary: beneficiary.clone(),
            token: token.clone(),
            expiry,
            milestone_total,
            funded_total: 0,
            released_total: 0,
            refunded_total: 0,
            refund_pool: None,
        };

        env.storage().persistent().set(&DataKey::State, &state);
        env.storage()
            .persistent()
            .set(&DataKey::Milestones, &milestones);
        env.storage()
            .persistent()
            .set(&DataKey::Donors, &Vec::<Address>::new(&env));
        Self::extend_core_ttl(&env);

        Initialized {
            arbiter,
            beneficiary,
            token,
            expiry,
            milestone_total,
        }
        .publish(&env);

        Ok(())
    }

    pub fn fund(env: Env, donor: Address, amount: i128) -> Result<(), Error> {
        let mut state = Self::load_state(&env);
        Self::ensure_active(&env, &state)?;

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let funded_total = state
            .funded_total
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;
        if funded_total > state.milestone_total {
            return Err(Error::FundingCapExceeded);
        }

        donor.require_auth();

        let donor_key = DataKey::DonorContribution(donor.clone());
        let donor_total = env
            .storage()
            .persistent()
            .get(&donor_key)
            .unwrap_or(0_i128)
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        let mut donors: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Donors)
            .unwrap_or_else(|| Vec::new(&env));
        if !donors.contains(&donor) {
            if donors.len() >= MAX_DONORS {
                return Err(Error::DonorLimitExceeded);
            }
            donors.push_back(donor.clone());
            env.storage().persistent().set(&DataKey::Donors, &donors);
        }

        let token_client = token::Client::new(&env, &state.token);
        token_client.transfer(&donor, env.current_contract_address(), &amount);

        state.funded_total = funded_total;
        env.storage().persistent().set(&DataKey::State, &state);
        env.storage().persistent().set(&donor_key, &donor_total);
        Self::extend_core_ttl(&env);
        Self::extend_key_ttl(&env, &donor_key);

        Funded {
            donor,
            amount,
            donor_total,
            funded_total,
        }
        .publish(&env);

        Ok(())
    }

    pub fn approve_milestone(env: Env, index: u32) -> Result<(), Error> {
        let mut state = Self::load_state(&env);
        Self::ensure_active(&env, &state)?;
        state.arbiter.require_auth();

        let mut milestones: Vec<Milestone> = env
            .storage()
            .persistent()
            .get(&DataKey::Milestones)
            .unwrap();
        let mut milestone = milestones.get(index).ok_or(Error::InvalidMilestoneIndex)?;

        if milestone.released {
            return Err(Error::MilestoneAlreadyReleased);
        }

        let available = state
            .funded_total
            .checked_sub(state.released_total)
            .and_then(|value| value.checked_sub(state.refunded_total))
            .ok_or(Error::ArithmeticOverflow)?;
        if available < milestone.amount {
            return Err(Error::InsufficientFunds);
        }

        let released_total = state
            .released_total
            .checked_add(milestone.amount)
            .ok_or(Error::ArithmeticOverflow)?;

        let token_client = token::Client::new(&env, &state.token);
        token_client.transfer(
            &env.current_contract_address(),
            &state.beneficiary,
            &milestone.amount,
        );

        milestone.released = true;
        milestones.set(index, milestone.clone());
        state.released_total = released_total;
        env.storage()
            .persistent()
            .set(&DataKey::Milestones, &milestones);
        env.storage().persistent().set(&DataKey::State, &state);
        Self::extend_core_ttl(&env);

        MilestoneApproved {
            index,
            amount: milestone.amount,
            released_total,
        }
        .publish(&env);

        Ok(())
    }

    pub fn refund(env: Env, donor: Address) -> Result<i128, Error> {
        let mut state = Self::load_state(&env);
        if env.ledger().sequence() < state.expiry {
            return Err(Error::InvalidExpiry);
        }

        donor.require_auth();

        let donor_key = DataKey::DonorContribution(donor.clone());
        let contribution: i128 = env
            .storage()
            .persistent()
            .get(&donor_key)
            .ok_or(Error::DonorNotFound)?;
        let claimed_key = DataKey::RefundClaimed(donor.clone());
        if env
            .storage()
            .persistent()
            .get(&claimed_key)
            .unwrap_or(false)
        {
            return Err(Error::AlreadyRefunded);
        }

        let refund_pool = match state.refund_pool {
            Some(pool) => pool,
            None => {
                let pool = state
                    .funded_total
                    .checked_sub(state.released_total)
                    .and_then(|value| value.checked_sub(state.refunded_total))
                    .ok_or(Error::ArithmeticOverflow)?;
                if pool <= 0 {
                    return Err(Error::NoRefundAvailable);
                }
                state.refund_pool = Some(pool);
                pool
            }
        };

        if refund_pool <= 0 {
            return Err(Error::NoRefundAvailable);
        }

        let donors: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Donors)
            .unwrap_or_else(|| Vec::new(&env));
        let unclaimed_donors = donors
            .iter()
            .filter(|address| {
                !env.storage()
                    .persistent()
                    .get(&DataKey::RefundClaimed(address.clone()))
                    .unwrap_or(false)
            })
            .count();

        let amount = if unclaimed_donors == 1 {
            refund_pool
                .checked_sub(state.refunded_total)
                .ok_or(Error::ArithmeticOverflow)?
        } else {
            contribution
                .checked_mul(refund_pool)
                .ok_or(Error::ArithmeticOverflow)?
                / state.funded_total
        };

        let refunded_total = state
            .refunded_total
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        if amount > 0 {
            let token_client = token::Client::new(&env, &state.token);
            token_client.transfer(&env.current_contract_address(), &donor, &amount);
        }

        env.storage().persistent().set(&claimed_key, &true);
        let donor_refund_key = DataKey::DonorRefund(donor.clone());
        env.storage().persistent().set(&donor_refund_key, &amount);
        state.refunded_total = refunded_total;
        env.storage().persistent().set(&DataKey::State, &state);
        Self::extend_core_ttl(&env);
        Self::extend_key_ttl(&env, &donor_key);
        Self::extend_key_ttl(&env, &claimed_key);
        Self::extend_key_ttl(&env, &donor_refund_key);

        Refunded {
            donor,
            amount,
            refunded_total,
        }
        .publish(&env);

        Ok(amount)
    }

    pub fn state(env: Env) -> EscrowState {
        Self::load_state(&env)
    }

    pub fn funded_total(env: Env) -> i128 {
        Self::load_state(&env).funded_total
    }

    pub fn milestone(env: Env, index: u32) -> Milestone {
        let milestones: Vec<Milestone> = env
            .storage()
            .persistent()
            .get(&DataKey::Milestones)
            .unwrap();
        milestones.get(index).unwrap()
    }

    pub fn milestone_count(env: Env) -> u32 {
        let milestones: Vec<Milestone> = env
            .storage()
            .persistent()
            .get(&DataKey::Milestones)
            .unwrap();
        milestones.len()
    }

    pub fn donor_contribution(env: Env, donor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::DonorContribution(donor))
            .unwrap_or(0)
    }

    /// Refresh shared state and one bounded page of donor records before they
    /// archive. Call repeatedly with the returned cursor until it returns 0.
    /// Permissionless so a campaign maintainer can use a separate fee-paying
    /// account without adding a custodial key to this contract.
    pub fn maintain_ttl(env: Env, start_index: u32) -> Result<u32, Error> {
        Self::load_state(&env);
        Self::extend_core_ttl(&env);

        let donors: Vec<Address> = env
            .storage()
            .persistent()
            .get(&DataKey::Donors)
            .unwrap_or_else(|| Vec::new(&env));
        let end_index = core::cmp::min(
            start_index.saturating_add(DONOR_TTL_BATCH_SIZE),
            donors.len(),
        );
        for index in start_index..end_index {
            let donor = donors.get(index).ok_or(Error::ArithmeticOverflow)?;
            let contribution_key = DataKey::DonorContribution(donor.clone());
            let refund_key = DataKey::DonorRefund(donor.clone());
            let claimed_key = DataKey::RefundClaimed(donor);
            Self::extend_key_ttl(&env, &contribution_key);
            Self::extend_key_ttl(&env, &refund_key);
            Self::extend_key_ttl(&env, &claimed_key);
        }
        if end_index >= donors.len() {
            Ok(0)
        } else {
            Ok(end_index)
        }
    }

    fn load_state(env: &Env) -> EscrowState {
        env.storage().persistent().get(&DataKey::State).unwrap()
    }

    fn extend_core_ttl(env: &Env) {
        env.storage()
            .instance()
            .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        Self::extend_key_ttl(env, &DataKey::State);
        Self::extend_key_ttl(env, &DataKey::Milestones);
        Self::extend_key_ttl(env, &DataKey::Donors);
    }

    fn extend_key_ttl(env: &Env, key: &DataKey) {
        if env.storage().persistent().has(key) {
            env.storage()
                .persistent()
                .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_BUMP);
        }
    }

    fn ensure_active(env: &Env, state: &EscrowState) -> Result<(), Error> {
        if env.ledger().sequence() >= state.expiry {
            Err(Error::EscrowExpired)
        } else {
            Ok(())
        }
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::testutils::storage::{Instance as _, Persistent};
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, Events as _, Ledger as _},
        token::StellarAssetClient,
        Env, Event, IntoVal, Symbol,
    };

    const NOW: u32 = 1_000;
    const EXPIRY: u32 = 2_000;

    struct Context {
        env: Env,
        contract_id: Address,
        token: Address,
        arbiter: Address,
        beneficiary: Address,
        donor_a: Address,
        donor_b: Address,
    }

    impl Context {
        fn client(&self) -> ScholarshipEscrowClient<'_> {
            ScholarshipEscrowClient::new(&self.env, &self.contract_id)
        }

        fn token_client(&self) -> StellarAssetClient<'_> {
            StellarAssetClient::new(&self.env, &self.token)
        }
    }

    fn context() -> Context {
        let env = Env::default();
        env.ledger().set_sequence_number(NOW);

        let arbiter = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let donor_a = Address::generate(&env);
        let donor_b = Address::generate(&env);

        let token_contract = env.register_stellar_asset_contract_v2(arbiter.clone());
        let token = token_contract.address();
        let token_client = StellarAssetClient::new(&env, &token);

        let contract_id = env.register(ScholarshipEscrow, ());
        let client = ScholarshipEscrowClient::new(&env, &contract_id);

        env.mock_all_auths();
        token_client.mint(&donor_a, &1_000);
        token_client.mint(&donor_b, &1_000);
        client.init(
            &arbiter,
            &beneficiary,
            &token,
            &soroban_sdk::vec![
                &env,
                Milestone {
                    amount: 600,
                    released: false,
                },
                Milestone {
                    amount: 400,
                    released: false,
                },
            ],
            &EXPIRY,
        );

        Context {
            env,
            contract_id,
            token,
            arbiter,
            beneficiary,
            donor_a,
            donor_b,
        }
    }

    #[test]
    fn init_stores_fixed_state_and_emits_event() {
        let ctx = context();
        let events = ctx.env.events().all().filter_by_contract(&ctx.contract_id);
        assert_eq!(
            events.events(),
            &[Initialized {
                arbiter: ctx.arbiter.clone(),
                beneficiary: ctx.beneficiary.clone(),
                token: ctx.token.clone(),
                expiry: EXPIRY,
                milestone_total: 1_000,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );

        let state = ctx.client().state();
        assert_eq!(state.arbiter, ctx.arbiter);
        assert_eq!(state.beneficiary, ctx.beneficiary);
        assert_eq!(state.token, ctx.token);
        assert_eq!(state.expiry, EXPIRY);
        assert_eq!(state.milestone_total, 1_000);
        assert_eq!(ctx.client().milestone(&0).amount, 600);
        assert!(!ctx.client().milestone(&0).released);
    }

    #[test]
    fn maintenance_refreshes_shared_state_and_donor_ttls() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &100);

        // Move close to the TTL threshold while keeping the entries live.
        ctx.env
            .ledger()
            .set_sequence_number(NOW + STORAGE_TTL_BUMP - STORAGE_TTL_THRESHOLD / 2);
        let old_ttl = ctx.env.as_contract(&ctx.contract_id, || {
            ctx.env.storage().persistent().get_ttl(&DataKey::State)
        });
        assert!(old_ttl < STORAGE_TTL_THRESHOLD);

        assert_eq!(ctx.client().maintain_ttl(&0), 0);
        let (state_ttl, donor_ttl, milestone_ttl, instance_ttl) =
            ctx.env.as_contract(&ctx.contract_id, || {
                (
                    ctx.env.storage().persistent().get_ttl(&DataKey::State),
                    ctx.env
                        .storage()
                        .persistent()
                        .get_ttl(&DataKey::DonorContribution(ctx.donor_a.clone())),
                    ctx.env.storage().persistent().get_ttl(&DataKey::Milestones),
                    ctx.env.storage().instance().get_ttl(),
                )
            });
        assert!(state_ttl >= STORAGE_TTL_BUMP - 1);
        assert!(donor_ttl >= STORAGE_TTL_BUMP - 1);
        assert!(milestone_ttl >= STORAGE_TTL_BUMP - 1);
        assert!(instance_ttl >= STORAGE_TTL_BUMP - 1);
    }

    #[test]
    fn maintenance_returns_bounded_donor_batch_cursors() {
        let ctx = context();
        let mut donors = Vec::new(&ctx.env);
        for _ in 0..DONOR_TTL_BATCH_SIZE + 1 {
            donors.push_back(Address::generate(&ctx.env));
        }
        ctx.env.as_contract(&ctx.contract_id, || {
            ctx.env
                .storage()
                .persistent()
                .set(&DataKey::Donors, &donors);
        });

        assert_eq!(ctx.client().maintain_ttl(&0), DONOR_TTL_BATCH_SIZE);
        assert_eq!(ctx.client().maintain_ttl(&DONOR_TTL_BATCH_SIZE), 0);
    }

    #[test]
    fn funding_is_tracked_per_donor_and_capped_at_milestone_total() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        ctx.client().fund(&ctx.donor_b, &400);

        assert_eq!(ctx.client().funded_total(), 1_000);
        assert_eq!(ctx.client().donor_contribution(&ctx.donor_a), 600);
        assert_eq!(ctx.client().donor_contribution(&ctx.donor_b), 400);
        assert_eq!(ctx.token_client().balance(&ctx.contract_id), 1_000);
        assert_eq!(
            ctx.client().try_fund(&ctx.donor_a, &1),
            Err(Ok(Error::FundingCapExceeded))
        );
    }

    #[test]
    fn arbiter_releases_exact_milestone_amount_once() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        ctx.client().approve_milestone(&0);

        assert_eq!(ctx.token_client().balance(&ctx.beneficiary), 600);
        assert_eq!(ctx.client().state().released_total, 600);
        assert!(ctx.client().milestone(&0).released);
        assert_eq!(
            ctx.client().try_approve_milestone(&0),
            Err(Ok(Error::MilestoneAlreadyReleased))
        );
    }

    #[test]
    fn cannot_release_more_than_funded() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &500);

        assert_eq!(
            ctx.client().try_approve_milestone(&0),
            Err(Ok(Error::InsufficientFunds))
        );
    }

    #[test]
    fn refunds_are_pro_rata_after_expiry_and_return_the_rounding_remainder() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        ctx.client().fund(&ctx.donor_b, &400);
        ctx.client().approve_milestone(&0);
        ctx.env.ledger().set_sequence_number(EXPIRY);

        assert_eq!(ctx.client().refund(&ctx.donor_b), 160);
        assert_eq!(ctx.client().refund(&ctx.donor_a), 240);
        assert_eq!(ctx.token_client().balance(&ctx.donor_a), 640);
        assert_eq!(ctx.token_client().balance(&ctx.donor_b), 760);
        assert_eq!(ctx.token_client().balance(&ctx.contract_id), 0);
        assert_eq!(ctx.client().state().refunded_total, 400);
        assert_eq!(
            ctx.client().try_refund(&ctx.donor_a),
            Err(Ok(Error::AlreadyRefunded))
        );
    }

    #[test]
    fn refund_rounding_dust_is_paid_to_the_final_claimant() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &333);
        ctx.client().fund(&ctx.donor_b, &667);
        ctx.client().approve_milestone(&0);
        ctx.env.ledger().set_sequence_number(EXPIRY);

        assert_eq!(ctx.client().refund(&ctx.donor_a), 133);
        assert_eq!(ctx.client().refund(&ctx.donor_b), 267);
        assert_eq!(ctx.client().state().refunded_total, 400);
        assert_eq!(ctx.token_client().balance(&ctx.contract_id), 0);
    }

    #[test]
    fn refund_before_expiry_is_rejected() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);

        assert_eq!(
            ctx.client().try_refund(&ctx.donor_a),
            Err(Ok(Error::InvalidExpiry))
        );
    }

    #[test]
    fn funding_and_approval_stop_at_expiry() {
        let ctx = context();
        ctx.env.ledger().set_sequence_number(EXPIRY);

        assert_eq!(
            ctx.client().try_fund(&ctx.donor_a, &1),
            Err(Ok(Error::EscrowExpired))
        );
        assert_eq!(
            ctx.client().try_approve_milestone(&0),
            Err(Ok(Error::EscrowExpired))
        );
    }

    #[test]
    fn funding_requires_donor_authorization() {
        let ctx = context();
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().fund(&ctx.donor_a, &1);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn approval_requires_arbiter_authorization() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().approve_milestone(&0);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn refund_requires_donor_authorization() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        ctx.env.ledger().set_sequence_number(EXPIRY);
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().refund(&ctx.donor_a);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn state_changes_emit_indexable_events() {
        let ctx = context();

        ctx.client().fund(&ctx.donor_a, &600);
        assert_eq!(
            ctx.env
                .events()
                .all()
                .filter_by_contract(&ctx.contract_id)
                .events(),
            &[Funded {
                donor: ctx.donor_a.clone(),
                amount: 600,
                donor_total: 600,
                funded_total: 600,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );

        ctx.client().fund(&ctx.donor_b, &400);
        ctx.client().approve_milestone(&0);
        assert_eq!(
            ctx.env
                .events()
                .all()
                .filter_by_contract(&ctx.contract_id)
                .events(),
            &[MilestoneApproved {
                index: 0,
                amount: 600,
                released_total: 600,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );

        ctx.env.ledger().set_sequence_number(EXPIRY);
        ctx.client().refund(&ctx.donor_b);
        assert_eq!(
            ctx.env
                .events()
                .all()
                .filter_by_contract(&ctx.contract_id)
                .events(),
            &[Refunded {
                donor: ctx.donor_b.clone(),
                amount: 160,
                refunded_total: 160,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );
    }

    #[test]
    fn auth_tree_contains_donor_and_arbiter_authorizations() {
        let ctx = context();
        ctx.client().fund(&ctx.donor_a, &600);
        let fund_auths = ctx.env.auths();
        assert!(fund_auths
            .iter()
            .any(|(address, _)| address == &ctx.donor_a));

        ctx.client().approve_milestone(&0);
        let approval_auths = ctx.env.auths();
        assert!(approval_auths.iter().any(|(address, invocation)| {
            address == &ctx.arbiter
                && invocation.function
                    == AuthorizedFunction::Contract((
                        ctx.contract_id.clone(),
                        Symbol::new(&ctx.env, "approve_milestone"),
                        (&0_u32,).into_val(&ctx.env),
                    ))
        }));
    }

    #[test]
    fn invalid_initialization_constraints_are_rejected() {
        let env = Env::default();
        env.ledger().set_sequence_number(NOW);
        let arbiter = Address::generate(&env);
        let beneficiary = Address::generate(&env);
        let token = Address::generate(&env);
        let contract_id = env.register(ScholarshipEscrow, ());
        let client = ScholarshipEscrowClient::new(&env, &contract_id);

        env.mock_all_auths();
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &soroban_sdk::Vec::new(&env),
                &EXPIRY,
            ),
            Err(Ok(Error::EmptyMilestones))
        );
        assert_eq!(
            client.try_init(
                &arbiter,
                &arbiter,
                &token,
                &soroban_sdk::vec![
                    &env,
                    Milestone {
                        amount: 1,
                        released: false,
                    }
                ],
                &EXPIRY,
            ),
            Err(Ok(Error::ActorsMustDiffer))
        );
        let mut too_many_milestones = soroban_sdk::Vec::new(&env);
        for _ in 0..=MAX_MILESTONES {
            too_many_milestones.push_back(Milestone {
                amount: 1,
                released: false,
            });
        }
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &too_many_milestones,
                &EXPIRY
            ),
            Err(Ok(Error::MilestoneLimitExceeded))
        );
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &soroban_sdk::vec![
                    &env,
                    Milestone {
                        amount: MAX_CAMPAIGN_STROOPS + 1,
                        released: false,
                    }
                ],
                &EXPIRY,
            ),
            Err(Ok(Error::CampaignLimitExceeded))
        );
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &soroban_sdk::vec![
                    &env,
                    Milestone {
                        amount: 0,
                        released: false,
                    }
                ],
                &EXPIRY,
            ),
            Err(Ok(Error::InvalidMilestoneAmount))
        );
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &soroban_sdk::vec![
                    &env,
                    Milestone {
                        amount: 1,
                        released: true,
                    }
                ],
                &EXPIRY,
            ),
            Err(Ok(Error::InvalidMilestoneState))
        );
        assert_eq!(
            client.try_init(
                &arbiter,
                &beneficiary,
                &token,
                &soroban_sdk::vec![
                    &env,
                    Milestone {
                        amount: 1,
                        released: false,
                    }
                ],
                &NOW,
            ),
            Err(Ok(Error::InvalidExpiry))
        );
    }

    #[test]
    fn initialization_cannot_run_twice() {
        let ctx = context();
        let milestones = soroban_sdk::vec![
            &ctx.env,
            Milestone {
                amount: 1_000,
                released: false,
            }
        ];

        assert_eq!(
            ctx.client().try_init(
                &ctx.arbiter,
                &ctx.beneficiary,
                &ctx.token,
                &milestones,
                &(EXPIRY + 1),
            ),
            Err(Ok(Error::AlreadyInitialized))
        );
    }

    #[test]
    fn donor_count_limit_is_enforced_before_transfer() {
        let ctx = context();
        let mut donors = Vec::new(&ctx.env);
        for _ in 0..MAX_DONORS {
            donors.push_back(Address::generate(&ctx.env));
        }
        ctx.env.as_contract(&ctx.contract_id, || {
            ctx.env
                .storage()
                .persistent()
                .set(&DataKey::Donors, &donors);
        });

        assert_eq!(
            ctx.client().try_fund(&ctx.donor_a, &1),
            Err(Ok(Error::DonorLimitExceeded))
        );
        assert_eq!(ctx.client().state().funded_total, 0);
        assert_eq!(ctx.token_client().balance(&ctx.contract_id), 0);
    }
}
