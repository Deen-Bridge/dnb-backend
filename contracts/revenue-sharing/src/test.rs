extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _},
    token::{StellarAssetClient, TokenClient},
    vec, Env, Event,
};

struct Ctx {
    env: Env,
    id: Address,
    token: Address,
    admin: Address,
    a: Address,
    b: Address,
    c: Address,
}

impl Ctx {
    fn client(&self) -> RevenueSharingClient<'_> {
        RevenueSharingClient::new(&self.env, &self.id)
    }
    fn fund(&self, amount: i128) {
        StellarAssetClient::new(&self.env, &self.token).mint(&self.id, &amount);
    }
    fn bal(&self, who: &Address) -> i128 {
        TokenClient::new(&self.env, &self.token).balance(who)
    }
}

fn setup(split: [u32; 3]) -> Ctx {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let (a, b, c) = (
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    );
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let id = env.register(RevenueSharing, ());
    RevenueSharingClient::new(&env, &id).init(
        &admin,
        &token,
        &vec![
            &env,
            (a.clone(), split[0]),
            (b.clone(), split[1]),
            (c.clone(), split[2]),
        ],
    );
    Ctx {
        env,
        id,
        token,
        admin,
        a,
        b,
        c,
    }
}

#[test]
fn even_split() {
    let ctx = setup([5_000, 3_000, 2_000]);
    ctx.fund(1_000);
    assert_eq!(ctx.client().distribute(), 1_000);
    assert_eq!(ctx.bal(&ctx.a), 500);
    assert_eq!(ctx.bal(&ctx.b), 300);
    assert_eq!(ctx.bal(&ctx.c), 200);
    assert_eq!(ctx.bal(&ctx.id), 0);
}

#[test]
fn rounding_remainder_goes_to_first_recipient() {
    // 3333/3333/3334 of 100 -> 33, 33, 33 = 99; dust 1 to first.
    let ctx = setup([3_333, 3_333, 3_334]);
    ctx.fund(100);
    ctx.client().distribute();
    assert_eq!(ctx.bal(&ctx.a), 34);
    assert_eq!(ctx.bal(&ctx.b), 33);
    assert_eq!(ctx.bal(&ctx.c), 33);
    assert_eq!(ctx.bal(&ctx.id), 0);
}

#[test]
fn tiny_balance_is_not_stranded() {
    let ctx = setup([5_000, 3_000, 2_000]);
    ctx.fund(1);
    ctx.client().distribute();
    assert_eq!(ctx.bal(&ctx.a), 1);
    assert_eq!(ctx.bal(&ctx.id), 0);
}

#[test]
fn cumulative_records_and_events() {
    let ctx = setup([5_000, 3_000, 2_000]);
    ctx.fund(1_000);
    ctx.client().distribute();
    let events = ctx.env.events().all().filter_by_contract(&ctx.id);
    assert_eq!(
        events.events(),
        &[
            Distributed {
                recipient: ctx.a.clone(),
                amount: 500,
                recipient_total: 500
            }
            .to_xdr(&ctx.env, &ctx.id),
            Distributed {
                recipient: ctx.b.clone(),
                amount: 300,
                recipient_total: 300
            }
            .to_xdr(&ctx.env, &ctx.id),
            Distributed {
                recipient: ctx.c.clone(),
                amount: 200,
                recipient_total: 200
            }
            .to_xdr(&ctx.env, &ctx.id),
        ]
    );
    ctx.fund(100);
    ctx.client().distribute();
    assert_eq!(ctx.client().total_distributed_to(&ctx.a), 550);
    assert_eq!(ctx.client().total_distributed_to(&ctx.b), 330);
    assert_eq!(ctx.client().total_distributed_to(&ctx.c), 220);
    assert_eq!(ctx.client().total_distributed(), 1_100);
}

#[test]
fn distribute_with_empty_balance_fails() {
    let ctx = setup([5_000, 3_000, 2_000]);
    assert_eq!(
        ctx.client().try_distribute(),
        Err(Ok(Error::NothingToDistribute))
    );
}

#[test]
fn admin_can_update_splits() {
    let ctx = setup([5_000, 3_000, 2_000]);
    let new = vec![
        &ctx.env,
        (ctx.b.clone(), 7_000u32),
        (ctx.c.clone(), 3_000u32),
    ];
    ctx.client().update_splits(&new);
    assert_eq!(ctx.client().recipients(), new);
    ctx.fund(1_000);
    ctx.client().distribute();
    assert_eq!(ctx.bal(&ctx.a), 0);
    assert_eq!(ctx.bal(&ctx.b), 700);
    assert_eq!(ctx.bal(&ctx.c), 300);
}

#[test]
fn update_splits_requires_admin_auth() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let a = Address::generate(&env);
    let token = env
        .register_stellar_asset_contract_v2(admin.clone())
        .address();
    let id = env.register(RevenueSharing, ());
    let client = RevenueSharingClient::new(&env, &id);
    env.mock_all_auths();
    client.init(&admin, &token, &vec![&env, (a.clone(), 10_000u32)]);
    // Drop the blanket auth mock: no one has authorised the call.
    env.set_auths(&[]);
    let res = client.try_update_splits(&vec![&env, (a, 10_000u32)]);
    assert!(res.is_err());
}

#[test]
fn invalid_splits_rejected() {
    let ctx = setup([5_000, 3_000, 2_000]);
    let c = ctx.client();
    let e = &ctx.env;
    let (a, b) = (ctx.a.clone(), ctx.b.clone());
    assert_eq!(
        c.try_update_splits(&Vec::new(e)),
        Err(Ok(Error::EmptySplits))
    );
    assert_eq!(
        c.try_update_splits(&vec![e, (a.clone(), 10_000u32), (b.clone(), 0u32)]),
        Err(Ok(Error::ZeroShare))
    );
    assert_eq!(
        c.try_update_splits(&vec![e, (a.clone(), 5_000u32), (a.clone(), 5_000u32)]),
        Err(Ok(Error::DuplicateRecipient))
    );
    assert_eq!(
        c.try_update_splits(&vec![e, (a.clone(), 5_000u32), (b.clone(), 4_999u32)]),
        Err(Ok(Error::InvalidTotal))
    );
    assert_eq!(
        c.try_update_splits(&vec![e, (a, 5_000u32), (b, 5_001u32)]),
        Err(Ok(Error::InvalidTotal))
    );
    // Original splits untouched.
    assert_eq!(c.recipients().len(), 3);
}

#[test]
fn init_rejects_bad_splits_and_reinit() {
    let ctx = setup([5_000, 3_000, 2_000]);
    let e = &ctx.env;
    assert_eq!(
        ctx.client()
            .try_init(&ctx.admin, &ctx.token, &vec![e, (ctx.a.clone(), 10_000u32)]),
        Err(Ok(Error::AlreadyInitialized))
    );
    let id2 = e.register(RevenueSharing, ());
    let c2 = RevenueSharingClient::new(e, &id2);
    assert_eq!(
        c2.try_init(&ctx.admin, &ctx.token, &vec![e, (ctx.a.clone(), 9_999u32)]),
        Err(Ok(Error::InvalidTotal))
    );
}
