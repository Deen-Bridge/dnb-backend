#![no_std]

//! Revenue sharing contract.
//!
//! Recipients are configured with basis-point shares that must sum to
//! `10_000`. Anyone may call `distribute` to split the contract's current
//! token balance among the recipients. Integer division remainder ("dust")
//! goes to the first recipient so nothing is stranded.
//!
//! Governance: for now `update_splits` is admin-only (`require_auth`).
//! Multi-sig / DAO governance is future work; the admin can be set to a
//! multi-sig account in the meantime.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Map,
    Vec,
};

pub const TOTAL_BPS: u32 = 10_000;
const MAX_RECIPIENTS: u32 = 50;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    EmptySplits = 3,
    ZeroShare = 4,
    DuplicateRecipient = 5,
    InvalidTotal = 6,
    TooManyRecipients = 7,
    NothingToDistribute = 8,
    ArithmeticOverflow = 9,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    Token,
    Recipients,
    Totals,
    TotalDistributed,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Distributed {
    #[topic]
    pub recipient: Address,
    pub amount: i128,
    pub recipient_total: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SplitsUpdated {
    #[topic]
    pub admin: Address,
    pub recipient_count: u32,
}

fn validate(recipients: &Vec<(Address, u32)>) -> Result<(), Error> {
    if recipients.is_empty() {
        return Err(Error::EmptySplits);
    }
    if recipients.len() > MAX_RECIPIENTS {
        return Err(Error::TooManyRecipients);
    }
    let mut sum: u32 = 0;
    for (i, (addr, bps)) in recipients.iter().enumerate() {
        if bps == 0 {
            return Err(Error::ZeroShare);
        }
        for j in 0..i as u32 {
            if recipients.get_unchecked(j).0 == addr {
                return Err(Error::DuplicateRecipient);
            }
        }
        sum = sum.checked_add(bps).ok_or(Error::InvalidTotal)?;
    }
    if sum != TOTAL_BPS {
        return Err(Error::InvalidTotal);
    }
    Ok(())
}

#[contract]
pub struct RevenueSharing;

#[contractimpl]
impl RevenueSharing {
    /// One-time setup. `recipients` is a list of (address, share in bps).
    pub fn init(
        env: Env,
        admin: Address,
        token: Address,
        recipients: Vec<(Address, u32)>,
    ) -> Result<(), Error> {
        let s = env.storage().instance();
        if s.has(&DataKey::Admin) {
            return Err(Error::AlreadyInitialized);
        }
        validate(&recipients)?;
        s.set(&DataKey::Admin, &admin);
        s.set(&DataKey::Token, &token);
        s.set(&DataKey::Recipients, &recipients);
        s.set(&DataKey::Totals, &Map::<Address, i128>::new(&env));
        s.set(&DataKey::TotalDistributed, &0i128);
        Ok(())
    }

    /// Replace the split table. Admin only (governance placeholder).
    pub fn update_splits(env: Env, new_recipients: Vec<(Address, u32)>) -> Result<(), Error> {
        let s = env.storage().instance();
        let admin: Address = s.get(&DataKey::Admin).ok_or(Error::NotInitialized)?;
        admin.require_auth();
        validate(&new_recipients)?;
        s.set(&DataKey::Recipients, &new_recipients);
        SplitsUpdated {
            admin,
            recipient_count: new_recipients.len(),
        }
        .publish(&env);
        Ok(())
    }

    /// Split the contract's whole token balance among the recipients.
    /// Callable by anyone. Returns the amount distributed.
    pub fn distribute(env: Env) -> Result<i128, Error> {
        let s = env.storage().instance();
        let token_addr: Address = s.get(&DataKey::Token).ok_or(Error::NotInitialized)?;
        let recipients: Vec<(Address, u32)> = s.get(&DataKey::Recipients).unwrap();
        let mut totals: Map<Address, i128> = s.get(&DataKey::Totals).unwrap();
        let client = token::Client::new(&env, &token_addr);
        let me = env.current_contract_address();

        let balance = client.balance(&me);
        if balance <= 0 {
            return Err(Error::NothingToDistribute);
        }

        let mut paid: i128 = 0;
        let mut amounts: Vec<i128> = Vec::new(&env);
        for (_, bps) in recipients.iter() {
            let share = balance
                .checked_mul(bps as i128)
                .ok_or(Error::ArithmeticOverflow)?
                / TOTAL_BPS as i128;
            paid += share;
            amounts.push_back(share);
        }
        // Rounding remainder goes to the first recipient.
        let dust = balance - paid;
        amounts.set(0, amounts.get_unchecked(0) + dust);

        for (i, (addr, _)) in recipients.iter().enumerate() {
            let amount = amounts.get_unchecked(i as u32);
            if amount == 0 {
                continue;
            }
            client.transfer(&me, &addr, &amount);
            let new_total = totals.get(addr.clone()).unwrap_or(0) + amount;
            totals.set(addr.clone(), new_total);
            Distributed {
                recipient: addr,
                amount,
                recipient_total: new_total,
            }
            .publish(&env);
        }
        s.set(&DataKey::Totals, &totals);
        let grand: i128 = s.get(&DataKey::TotalDistributed).unwrap_or(0);
        s.set(&DataKey::TotalDistributed, &(grand + balance));
        Ok(balance)
    }

    pub fn recipients(env: Env) -> Vec<(Address, u32)> {
        env.storage()
            .instance()
            .get(&DataKey::Recipients)
            .unwrap_or(Vec::new(&env))
    }

    /// Cumulative amount distributed to `recipient`.
    pub fn total_distributed_to(env: Env, recipient: Address) -> i128 {
        let totals: Map<Address, i128> = env
            .storage()
            .instance()
            .get(&DataKey::Totals)
            .unwrap_or(Map::new(&env));
        totals.get(recipient).unwrap_or(0)
    }

    /// Cumulative amount distributed to all recipients.
    pub fn total_distributed(env: Env) -> i128 {
        env.storage()
            .instance()
            .get(&DataKey::TotalDistributed)
            .unwrap_or(0)
    }

    pub fn admin(env: Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
