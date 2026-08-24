// services/stellar/loyaltyService.js
//
// Backend bridge to the Deen Bridge loyalty-points Soroban contract
// (contracts/loyalty-points). Users earn points for platform activities
// (course/book purchases, referrals, milestones), redeem them for discounts,
// and can transfer them to other users.
//
// Consistent with the rest of this module's Stellar services, all signing
// stays client-side: this service BUILDS UNSIGNED transaction XDR that the
// frontend signs and submits, performs read-only queries against Soroban RPC,
// and never holds keys. Server-signed flows (admin mint/rate changes) are an
// explicit extension point marked below.
//
// Contract surface (see contracts/loyalty-points/src/lib.rs):
//   init(admin) / set_rate(activity, rate)          — admin setup
//   earn(user, activity, spend_amount) -> balance   — claim activity points
//   mint(user, amount)                              — admin issuance
//   redeem(user, amount) -> balance                 — burn for rewards
//   transfer(from, to, amount)                      — user-to-user gifting
//   balance(user) / rate(activity) / state()        — views

import * as StellarSdk from "@stellar/stellar-sdk";
import logger from "../../config/logger.js";
import { resolveStellarNetwork } from "../../config/stellar.js";

/** Env var holding the deployed loyalty contract id (C…55-char StrKey). */
export const LOYALTY_CONTRACT_ENV = "LOYALTY_CONTRACT_ID";

/** Default public Soroban RPC endpoints per network. */
const SOROBAN_RPC_DEFAULTS = {
  testnet: "https://soroban-testnet.stellar.org",
  // No fixed public mainnet RPC — operators must configure one explicitly.
  mainnet: null,
};

/** Allowed activity discriminants, mirroring the contract's Activity enum. */
export const LOYALTY_ACTIVITIES = Object.freeze({
  PURCHASE: "Purchase",
  REFERRAL: "Referral",
  MILESTONE: "Milestone",
});

/**
 * Resolve the configured network using the shared Stellar config.
 * @returns {string} "testnet" | "mainnet"
 */
export const resolveLoyaltyNetwork = () => resolveStellarNetwork();

/**
 * Lazily-built singleton RPC client for the active network.
 *
 * @returns {{server: StellarSdk.rpc.Server, networkPassphrase: string}}
 */
let cachedRpc;
export const loyaltyRpc = () => {
  if (cachedRpc) return cachedRpc;

  const network = resolveLoyaltyNetwork();
  const url =
    process.env.SOROBAN_RPC_URL || SOROBAN_RPC_DEFAULTS[network] || null;
  if (!url) {
    throw new Error(
      `SOROBAN_RPC_URL must be configured for the "${network}" network`
    );
  }

  const passphrase =
    StellarSdk.Networks[network.toUpperCase()] ??
    (() => {
      throw new Error(`Unknown Stellar network "${network}"`);
    })();

  cachedRpc = {
    server: new StellarSdk.rpc.Server(url, {
      allowHttp: url.startsWith("http://"),
    }),
    networkPassphrase: passphrase,
  };
  return cachedRpc;
};

/**
 * The deployed loyalty contract handle.
 *
 * @returns {StellarSdk.Contract}
 */
export const loyaltyContract = () => {
  const contractId = process.env[LOYALTY_CONTRACT_ENV];
  if (!contractId) {
    throw new Error(
      `${LOYALTY_CONTRACT_ENV} is not configured — deploy contracts/loyalty-points and record its id`
    );
  }
  return new StellarSdk.Contract(contractId);
};

/* ------------------------------------------------------------------ */
/* Encoding helpers                                                    */
/* ------------------------------------------------------------------ */

/** @returns {StellarSdk.xdr.ScVal} */
const addressScVal = (publicKey) =>
  StellarSdk.Address.fromString(publicKey).toScVal();

/** @returns {StellarSdk.xdr.ScVal} */
const i128ScVal = (value) =>
  StellarSdk.nativeToScVal(BigInt(value), { type: "i128" });

/** Activity enum values encode as their variant symbol on-chain. */
const activityScVal = (activity) => {
  if (!Object.values(LOYALTY_ACTIVITIES).includes(activity)) {
    throw new Error(
      `Unknown loyalty activity "${activity}" — expected one of ${Object.values(
        LOYALTY_ACTIVITIES
      ).join(", ")}`
    );
  }
  return StellarSdk.xdr.ScVal.scvSymbol(activity);
};

/* ------------------------------------------------------------------ */
/* Unsigned transaction builders (client signs & submits)              */
/* ------------------------------------------------------------------ */

/**
 * Shared builder: assemble an unsigned Soroban invoke for the loyalty
 * contract. The returned XDR must be signed by `sourcePublicKey`'s keypair
 * and submitted via a wallet or the platform's submission flow.
 *
 * @param {string} sourcePublicKey Signer's G… address (sequence source).
 * @param {(contract: StellarSdk.Contract) => StellarSdk.xdr.Operation} buildOp
 * @param {{memo?: string}} [options]
 * @returns {Promise<{xdr: string, contractId: string, networkPassphrase: string}>}
 */
const buildInvokeTx = async (sourcePublicKey, buildOp, options = {}) => {
  const { server, networkPassphrase } = loyaltyRpc();
  const contract = loyaltyContract();

  const account = await server.getAccount(sourcePublicKey);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
    memo: options.memo ? StellarSdk.Memo.text(options.memo) : undefined,
  })
    .addOperation(buildOp(contract))
    .setTimeout(180)
    .build();

  logger.debug(
    { sourcePublicKey, contractId: contract.contractId() },
    "Built unsigned loyalty contract invocation"
  );

  return {
    xdr: tx.toXDR(),
    contractId: contract.contractId(),
    networkPassphrase,
  };
};

/**
 * Build an unsigned `earn(user, activity, spend_amount)` invocation so a user
 * can claim points for a completed platform activity.
 *
 * @param {{sourcePublicKey: string, activity: string, spendAmount?: number|string}} params
 *   `spendAmount` is required for purchases (raw 7-decimal asset units) and
 *   ignored for flat-bonus activities.
 */
export const buildEarnPointsTx = ({ sourcePublicKey, activity, spendAmount = 0 }) =>
  buildInvokeTx(sourcePublicKey, (contract) =>
    contract.call(
      "earn",
      addressScVal(sourcePublicKey),
      activityScVal(activity),
      i128ScVal(spendAmount)
    )
  );

/**
 * Build an unsigned `redeem(user, amount)` invocation that burns points
 * against a discount/reward.
 *
 * @param {{sourcePublicKey: string, amount: number|string}} params
 */
export const buildRedeemPointsTx = ({ sourcePublicKey, amount }) =>
  buildInvokeTx(
    sourcePublicKey,
    (contract) =>
      contract.call("redeem", addressScVal(sourcePublicKey), i128ScVal(amount)),
    { memo: "DeenBridge Rewards" }
  );

/**
 * Build an unsigned `transfer(from, to, amount)` invocation for gifting.
 *
 * @param {{sourcePublicKey: string, destinationPublicKey: string, amount: number|string}} params
 */
export const buildTransferPointsTx = ({
  sourcePublicKey,
  destinationPublicKey,
  amount,
}) =>
  buildInvokeTx(
    sourcePublicKey,
    (contract) =>
      contract.call(
        "transfer",
        addressScVal(sourcePublicKey),
        addressScVal(destinationPublicKey),
        i128ScVal(amount)
      ),
    { memo: "DeenBridge Points Gift" }
  );

/**
 * ADMIN FLOW (extension point): build an unsigned `set_rate` invocation.
 * Today the admin signs off-platform; wire a secured key management flow
 * before ever exposing this through a route.
 *
 * @param {{adminPublicKey: string, activity: string, rate: number|string}} params
 */
export const buildSetRateTx = ({ adminPublicKey, activity, rate }) =>
  buildInvokeTx(adminPublicKey, (contract) =>
    contract.call("set_rate", activityScVal(activity), i128ScVal(rate))
  );

/* ------------------------------------------------------------------ */
/* Read-only queries                                                   */
/* ------------------------------------------------------------------ */

/**
 * Simulate a read-only contract call without submitting a transaction.
 * Simulation requires a funded sequence source, so callers pass any funded
 * G… address they control (typically the querying user's own public key).
 *
 * @param {{sourcePublicKey: string, method: string, args?: StellarSdk.xdr.ScVal[]}} params
 * @returns {Promise<StellarSdk.xdr.ScVal>} raw return value
 */
const queryContract = async ({ sourcePublicKey, method, args = [] }) => {
  if (!sourcePublicKey) {
    throw new Error(
      `A funded sourcePublicKey is required to query "${method}" from the loyalty contract`
    );
  }

  const { server, networkPassphrase } = loyaltyRpc();
  const account = await server.getAccount(sourcePublicKey);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(loyaltyContract().call(method, ...args))
    .setTimeout(60)
    .build();

  const simulation = await server.simulateTransaction(tx);
  if (simulation.error || !simulation.result?.retval) {
    throw new Error(
      `Loyalty query "${method}" failed: ${simulation.error ?? "no result"}`
    );
  }
  return simulation.result.retval;
};

/**
 * On-chain point balance for a user.
 *
 * @param {{publicKey: string, sourcePublicKey?: string}} params
 *   `sourcePublicKey` defaults to `publicKey` when it is itself funded.
 * @returns {Promise<bigint>}
 */
export const getLoyaltyBalance = async ({ publicKey, sourcePublicKey }) => {
  const retval = await queryContract({
    sourcePublicKey: sourcePublicKey ?? publicKey,
    method: "balance",
    args: [addressScVal(publicKey)],
  });
  return StellarSdk.scValToNative(retval);
};

/**
 * Configured award rate for an activity (0 when never set).
 *
 * @param {{activity: string, sourcePublicKey: string}} params
 * @returns {Promise<bigint>}
 */
export const getLoyaltyRate = async ({ activity, sourcePublicKey }) => {
  const retval = await queryContract({
    sourcePublicKey,
    method: "rate",
    args: [activityScVal(activity)],
  });
  return StellarSdk.scValToNative(retval);
};

/**
 * Program totals/admin — mirrors the contract's LoyaltyState struct.
 *
 * @param {{sourcePublicKey: string}} params
 * @returns {Promise<{admin: string, totalIssued: bigint, totalRedeemed: bigint}>}
 */
export const getLoyaltyState = async ({ sourcePublicKey }) => {
  const retval = await queryContract({ sourcePublicKey, method: "state" });
  const native = StellarSdk.scValToNative(retval);
  return {
    admin: String(native.admin),
    totalIssued: BigInt(native.total_issued ?? 0),
    totalRedeemed: BigInt(native.total_redeemed ?? 0),
  };
};
