//! Deen Bridge Loyalty Points — on-chain points system for platform activities.
//!
//! Users earn points for purchases, referrals, and milestones. Points live in
//! an internal ledger (not a SAC token) so the admin keeps full control over
//! issuance, while earning/redemption/transfers remain fully on-chain and
//! auditable through indexable events:
//!
//!   - **Earning**: `earn` mints points per configurable per-activity rules
//!     (points-per-unit-spend for purchases, flat bonuses for referrals and
//!     milestones). Rules are set by the admin via `set_rate`.
//!   - **Redemption**: `redeem` burns points against discounts/rewards; the
//!     discount itself is granted off-chain by the backend after the burn.
//!   - **Transfers**: users can gift points to other users via `transfer`.
//!
//! Storage layout mirrors scholarship_escrow: one persistent `State` entry,
//! per-user `Balance` entries, and per-activity `Rate` entries.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, Address, Env, Symbol,
};

/// One whole unit of a 7-decimal Stellar asset (e.g. USDC), used to normalize
/// purchase spend into whole units before applying the points rate.
const ASSET_PRECISION: i128 = 10_000_000;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InvalidRate = 4,
    RateNotSet = 5,
    InsufficientBalance = 6,
    ArithmeticOverflow = 7,
    SameAccount = 8,
}

/// Platform activities that award loyalty points.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Activity {
    /// Course/book purchase — points scale with the amount spent.
    Purchase = 0,
    /// Successful user referral — flat bonus.
    Referral = 1,
    /// Platform milestone (e.g. first course completed) — flat bonus.
    Milestone = 2,
}

/// Global counters and admin identity.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoyaltyState {
    pub admin: Address,
    pub total_issued: i128,
    pub total_redeemed: i128,
}

#[contracttype]
#[derive(Clone)]
enum DataKey {
    State,
    Balance(Address),
    Rate(Activity),
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Initialized {
    #[topic]
    pub admin: Address,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RateUpdated {
    #[topic]
    pub activity: Symbol,
    pub rate: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Earned {
    #[topic]
    pub user: Address,
    #[topic]
    pub activity: Symbol,
    pub earned: i128,
    pub balance: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Minted {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub balance: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Redeemed {
    #[topic]
    pub user: Address,
    pub amount: i128,
    pub balance: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Transferred {
    #[topic]
    pub from: Address,
    #[topic]
    pub to: Address,
    pub amount: i128,
    pub from_balance: i128,
    pub to_balance: i128,
}

#[contract]
pub struct LoyaltyPoints;

#[contractimpl]
impl LoyaltyPoints {
    /// Initialize the program with its admin (the platform issuer account).
    pub fn init(env: Env, admin: Address) -> Result<(), Error> {
        if env.storage().persistent().has(&DataKey::State) {
            return Err(Error::AlreadyInitialized);
        }

        admin.require_auth();

        let state = LoyaltyState {
            admin: admin.clone(),
            total_issued: 0,
            total_redeemed: 0,
        };
        env.storage().persistent().set(&DataKey::State, &state);

        Initialized { admin }.publish(&env);

        Ok(())
    }

    /// Configure how many points an activity awards.
    ///
    /// For [`Activity::Purchase`] the rate is expressed as points per whole
    /// asset unit of spend (a spend of 5 USDC at rate 100 awards 500 points).
    /// For referrals and milestones it is the flat bonus per event.
    pub fn set_rate(env: Env, activity: Activity, rate: i128) -> Result<(), Error> {
        let mut state = Self::load_state(&env);
        state.admin.require_auth();

        if rate < 0 {
            return Err(Error::InvalidRate);
        }

        env.storage()
            .persistent()
            .set(&DataKey::Rate(activity.clone()), &rate);

        RateUpdated {
            activity: Self::activity_symbol(&env, &activity),
            rate,
        }
        .publish(&env);

        Ok(())
    }

    /// Award points to `user` for completing `activity`.
    ///
    /// `spend_amount` is only meaningful for purchases (the amount spent, in
    /// raw asset units); it is ignored for flat-bonus activities. The user
    /// authorizes the claim so points cannot be attributed without consent.
    pub fn earn(
        env: Env,
        user: Address,
        activity: Activity,
        spend_amount: i128,
    ) -> Result<i128, Error> {
        let mut state = Self::load_state(&env);
        Self::ensure_spend_valid(activity, spend_amount)?;

        let rate = env
            .storage()
            .persistent()
            .get::<_, i128>(&DataKey::Rate(activity.clone()))
            .ok_or(Error::RateNotSet)?;
        if rate == 0 {
            return Err(Error::RateNotSet);
        }

        let earned = match activity {
            // Points scale with spend: (spend / precision) * rate, floored.
            Activity::Purchase => spend_amount
                .checked_mul(rate)
                .ok_or(Error::ArithmeticOverflow)?
                / ASSET_PRECISION,
            _ => rate,
        };

        user.require_auth();

        let balance_key = DataKey::Balance(user.clone());
        let balance = env
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0_i128)
            .checked_add(earned)
            .ok_or(Error::ArithmeticOverflow)?;

        state.total_issued = state
            .total_issued
            .checked_add(earned)
            .ok_or(Error::ArithmeticOverflow)?;

        env.storage().persistent().set(&balance_key, &balance);
        env.storage().persistent().set(&DataKey::State, &state);

        Earned {
            user: user.clone(),
            activity: Self::activity_symbol(&env, &activity),
            earned,
            balance,
        }
        .publish(&env);

        Ok(balance)
    }

    /// Admin-only issuance for support/reward flows outside the standard
    /// earning rules (e.g. contest prizes).
    pub fn mint(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        let mut state = Self::load_state(&env);
        state.admin.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        let balance_key = DataKey::Balance(user.clone());
        let balance = env
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0_i128)
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        state.total_issued = state
            .total_issued
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        env.storage().persistent().set(&balance_key, &balance);
        env.storage().persistent().set(&DataKey::State, &state);

        Minted {
            user: user.clone(),
            amount,
            balance,
        }
        .publish(&env);

        Ok(balance)
    }

    /// Burn points as payment for a discount/reward. The reward itself is
    /// granted by the backend once this redemption is observed on-chain.
    pub fn redeem(env: Env, user: Address, amount: i128) -> Result<i128, Error> {
        let mut state = Self::load_state(&env);

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        user.require_auth();

        let balance_key = DataKey::Balance(user.clone());
        let balance = env
            .storage()
            .persistent()
            .get(&balance_key)
            .unwrap_or(0_i128);
        if balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let new_balance = balance - amount;
        state.total_redeemed = state
            .total_redeemed
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        env.storage().persistent().set(&balance_key, &new_balance);
        env.storage().persistent().set(&DataKey::State, &state);

        Redeemed {
            user: user.clone(),
            amount,
            balance: new_balance,
        }
        .publish(&env);

        Ok(new_balance)
    }

    /// Move points between two users (gifting). The sender authorizes.
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) -> Result<(), Error> {
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if from == to {
            return Err(Error::SameAccount);
        }

        from.require_auth();

        let from_key = DataKey::Balance(from.clone());
        let from_balance = env
            .storage()
            .persistent()
            .get(&from_key)
            .unwrap_or(0_i128);
        if from_balance < amount {
            return Err(Error::InsufficientBalance);
        }

        let to_key = DataKey::Balance(to.clone());
        let to_balance = env
            .storage()
            .persistent()
            .get(&to_key)
            .unwrap_or(0_i128)
            .checked_add(amount)
            .ok_or(Error::ArithmeticOverflow)?;

        env.storage()
            .persistent()
            .set(&from_key, &(from_balance - amount));
        env.storage().persistent().set(&to_key, &to_balance);

        Transferred {
            from,
            to,
            amount,
            from_balance: from_balance - amount,
            to_balance,
        }
        .publish(&env);

        Ok(())
    }

    /// Current point balance of `user`.
    pub fn balance(env: Env, user: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(user))
            .unwrap_or(0)
    }

    /// Program state (admin, totals) for transparency dashboards.
    pub fn state(env: Env) -> LoyaltyState {
        Self::load_state(&env)
    }

    /// Configured award rate for `activity`; `None`-equivalent is an error
    /// path in `try_rate`, here it surfaces as 0 for view simplicity.
    pub fn rate(env: Env, activity: Activity) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Rate(activity))
            .unwrap_or(0)
    }

    fn load_state(env: &Env) -> LoyaltyState {
        env.storage().persistent().get(&DataKey::State).unwrap()
    }

    fn ensure_spend_valid(activity: Activity, spend_amount: i128) -> Result<(), Error> {
        match activity {
            Activity::Purchase if spend_amount <= 0 => Err(Error::InvalidAmount),
            _ => Ok(()),
        }
    }

    fn activity_symbol(env: &Env, activity: &Activity) -> Symbol {
        Symbol::new(
            env,
            match activity {
                Activity::Purchase => "purchase",
                Activity::Referral => "referral",
                Activity::Milestone => "milestone",
            },
        )
    }
}

#[cfg(test)]
mod test {
    extern crate std;

    use super::*;
    use soroban_sdk::{
        testutils::{Address as _, AuthorizedFunction, Events as _},
        Env, Event, IntoVal, Symbol,
    };

    struct Context {
        env: Env,
        contract_id: Address,
        admin: Address,
        user: Address,
        other: Address,
    }

    impl Context {
        fn client(&self) -> LoyaltyPointsClient<'_> {
            LoyaltyPointsClient::new(&self.env, &self.contract_id)
        }
    }

    fn context() -> Context {
        let env = Env::default();
        let admin = Address::generate(&env);
        let user = Address::generate(&env);
        let other = Address::generate(&env);

        let contract_id = env.register(LoyaltyPoints, ());
        let client = LoyaltyPointsClient::new(&env, &contract_id);

        env.mock_all_auths();
        client.init(&admin);

        Context {
            env,
            contract_id,
            admin,
            user,
            other,
        }
    }

    #[test]
    fn init_stores_admin_and_emits_event() {
        let ctx = context();
        assert_eq!(ctx.client().state().admin, ctx.admin);
        assert_eq!(ctx.client().state().total_issued, 0);
        assert_eq!(
            ctx.env.events().all().filter_by_contract(&ctx.contract_id).events(),
            &[Initialized {
                admin: ctx.admin.clone(),
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );
    }

    #[test]
    fn purchase_points_scale_with_spend_and_configured_rate() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Purchase, &100);

        // 5 whole units spent at 100 points/unit → 500 points.
        assert_eq!(ctx.client().earn(&ctx.user, &Activity::Purchase, &50_000_000), 500);
        assert_eq!(ctx.client().balance(&ctx.user), 500);
        assert_eq!(ctx.client().state().total_issued, 500);
    }

    #[test]
    fn flat_activities_award_their_bonus_exactly_once_per_claim() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Referral, &250);
        ctx.client().set_rate(&Activity::Milestone, &1_000);

        assert_eq!(ctx.client().earn(&ctx.user, &Activity::Referral, &0), 250);
        assert_eq!(ctx.client().earn(&ctx.other, &Activity::Milestone, &0), 1_000);
        assert_eq!(ctx.client().state().total_issued, 1_250);
    }

    #[test]
    fn unconfigured_rates_are_rejected_rather_than_awarding_zero() {
        let ctx = context();
        assert_eq!(
            ctx.client().try_earn(&ctx.user, &Activity::Milestone, &0),
            Err(Ok(Error::RateNotSet))
        );

        // Explicitly zeroed rates behave the same way.
        ctx.client().set_rate(&Activity::Referral, &0);
        assert_eq!(
            ctx.client().try_earn(&ctx.user, &Activity::Referral, &0),
            Err(Ok(Error::RateNotSet))
        );
    }

    #[test]
    fn purchase_requires_positive_spend() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Purchase, &100);
        assert_eq!(
            ctx.client().try_earn(&ctx.user, &Activity::Purchase, &0),
            Err(Ok(Error::InvalidAmount))
        );
    }

    #[test]
    fn redemption_burns_points_and_tracks_totals() {
        let ctx = context();
        ctx.client().mint(&ctx.user, &400);
        assert_eq!(ctx.client().redeem(&ctx.user, &150), 250);
        assert_eq!(ctx.client().balance(&ctx.user), 250);
        assert_eq!(ctx.client().state().total_redeemed, 150);

        assert_eq!(
            ctx.client().try_redeem(&ctx.user, &251),
            Err(Ok(Error::InsufficientBalance))
        );
    }

    #[test]
    fn transfers_move_balances_between_users() {
        let ctx = context();
        ctx.client().mint(&ctx.user, &300);
        ctx.client().transfer(&ctx.user, &ctx.other, &180);

        assert_eq!(ctx.client().balance(&ctx.user), 120);
        assert_eq!(ctx.client().balance(&ctx.other), 180);
        assert_eq!(
            ctx.client().try_transfer(&ctx.user, &ctx.other, &121),
            Err(Ok(Error::InsufficientBalance))
        );
    }

    #[test]
    fn transfers_to_self_are_rejected() {
        let ctx = context();
        ctx.client().mint(&ctx.user, &300);
        assert_eq!(
            ctx.client().try_transfer(&ctx.user, &ctx.user, &10),
            Err(Ok(Error::SameAccount))
        );
    }

    #[test]
    fn invalid_mints_and_redemptions_are_rejected() {
        let ctx = context();
        assert_eq!(
            ctx.client().try_mint(&ctx.user, &0),
            Err(Ok(Error::InvalidAmount))
        );
        assert_eq!(
            ctx.client().try_redeem(&ctx.user, &0),
            Err(Ok(Error::InvalidAmount))
        );
        assert_eq!(
            ctx.client().try_set_rate(&Activity::Purchase, &-1),
            Err(Ok(Error::InvalidRate))
        );
    }

    #[test]
    fn initialization_cannot_run_twice() {
        let ctx = context();
        assert_eq!(
            ctx.client().try_init(&ctx.admin),
            Err(Ok(Error::AlreadyInitialized))
        );
    }

    #[test]
    fn earning_requires_user_authorization() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Referral, &250);
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().earn(&ctx.user, &Activity::Referral, &0);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn rate_changes_require_admin_authorization() {
        let ctx = context();
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().set_rate(&Activity::Purchase, &100);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn redemption_requires_user_authorization() {
        let ctx = context();
        ctx.client().mint(&ctx.user, &100);
        ctx.env.set_auths(&[]);

        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ctx.client().redeem(&ctx.user, &50);
        }));
        assert!(result.is_err());
    }

    #[test]
    fn state_changes_emit_indexable_events() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Purchase, &100);

        assert_eq!(
            ctx.env.events().all().filter_by_contract(&ctx.contract_id).events(),
            &[RateUpdated {
                activity: Symbol::new(&ctx.env, "purchase"),
                rate: 100,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );

        ctx.client().earn(&ctx.user, &Activity::Purchase, &30_000_000);
        assert_eq!(
            ctx.env.events().all().filter_by_contract(&ctx.contract_id).events(),
            &[Earned {
                user: ctx.user.clone(),
                activity: Symbol::new(&ctx.env, "purchase"),
                earned: 300,
                balance: 300,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );

        ctx.client().redeem(&ctx.user, &100);
        assert_eq!(
            ctx.env.events().all().filter_by_contract(&ctx.contract_id).events(),
            &[Redeemed {
                user: ctx.user.clone(),
                amount: 100,
                balance: 200,
            }
            .to_xdr(&ctx.env, &ctx.contract_id)]
        );
    }

    #[test]
    fn auth_tree_contains_admin_and_user_authorizations() {
        let ctx = context();
        ctx.client().set_rate(&Activity::Purchase, &100);
        let rate_auths = ctx.env.auths();
        assert!(rate_auths.iter().any(|(address, _)| address == &ctx.admin));

        ctx.client().earn(&ctx.user, &Activity::Purchase, &10_000_000);
        let earn_auths = ctx.env.auths();
        assert!(earn_auths
            .iter()
            .any(|(address, invocation)| address == &ctx.user
                && invocation.function
                    == AuthorizedFunction::Contract((
                        ctx.contract_id.clone(),
                        Symbol::new(&ctx.env, "earn"),
                        (&ctx.user, &Activity::Purchase, &10_000_000_i128).into_val(&ctx.env),
                    ))));
    }
}
