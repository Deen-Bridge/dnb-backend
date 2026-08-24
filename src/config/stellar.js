// config/stellar.js
//
// Single source of truth for the Stellar network configuration. Everything
// that depends on which network the app is running against (network
// passphrase, Horizon URL, USDC issuer, default asset) resolves through this
// module instead of being derived ad-hoc in each service.
//
// Network values accepted:
//   - "testnet"               -> testnet (default when unset, for back-compat)
//   - "mainnet" | "public"    -> mainnet ("public" is the Stellar SDK / SDF
//                                name for the production network)
//
// Startup validation (validateStellarConfig) makes a misconfigured deployment
// fail at boot with a message naming the exact problem, rather than failing
// at request time on the first Horizon call.

import * as StellarSdk from "@stellar/stellar-sdk";
import { getAssetConfig, getDefaultAssetCode } from "./assets.js";

/** Normalized network names used as registry keys / DB enum values. */
export const STELLAR_NETWORK_ALIASES = Object.freeze({
  testnet: "testnet",
  mainnet: "mainnet",
  public: "mainnet",
});

/** Canonical Horizon endpoints per network (used when HORIZON_URLS is unset). */
export const HORIZON_DEFAULTS = Object.freeze({
  testnet: "https://horizon-testnet.stellar.org",
  mainnet: "https://horizon.stellar.org",
});

/**
 * Canonical USDC issuers per network (Circle). Documented here as the
 * reference; the asset registry (assets.js) must agree with it —
 * validateStellarConfig() cross-checks the registry against these constants
 * so a mainnet flag paired with a testnet issuer can never silently boot.
 */
export const USDC_ISSUERS = Object.freeze({
  testnet: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  mainnet: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
});

/**
 * Resolve and normalize the configured Stellar network.
 * @param {string} [raw] - raw STELLAR_NETWORK value (defaults to process.env)
 * @returns {"testnet"|"mainnet"}
 * @throws {Error} naming the exact problem when the value is not recognized
 */
export const resolveStellarNetwork = (raw = process.env.STELLAR_NETWORK) => {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!value) {
    // Back-compat: unset means testnet, matching the historical default.
    return "testnet";
  }
  const network = STELLAR_NETWORK_ALIASES[value];
  if (!network) {
    throw new Error(
      `Invalid STELLAR_NETWORK "${raw}": expected "testnet", "mainnet", or "public". ` +
        "DeenBridge defaults to testnet; switch to mainnet/public only when the whole " +
        "stack (Horizon, USDC issuer, frontend NEXT_PUBLIC_STELLAR_NETWORK) is ready " +
        "for mainnet — see docs/MAINNET.md."
    );
  }
  return network;
};

/**
 * Resolve the full Stellar configuration from the environment.
 * @returns {{
 *   network: "testnet"|"mainnet",
 *   networkPassphrase: string,
 *   horizonUrls: string[],
 *   primaryHorizonUrl: string,
 *   usdcIssuer: string,
 *   defaultAssetCode: string,
 * }}
 */
export const resolveStellarConfig = () => {
  const network = resolveStellarNetwork();
  const rawUrls =
    process.env.HORIZON_URLS || HORIZON_DEFAULTS[network];
  const horizonUrls = rawUrls
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  const usdc = getAssetConfig("USDC", network);

  return {
    network,
    networkPassphrase:
      network === "mainnet"
        ? StellarSdk.Networks.PUBLIC
        : StellarSdk.Networks.TESTNET,
    horizonUrls,
    primaryHorizonUrl: horizonUrls[0] || HORIZON_DEFAULTS[network],
    usdcIssuer: usdc.issuer,
    defaultAssetCode: getDefaultAssetCode(network),
  };
};

/**
 * Fail-fast startup validation of the Stellar configuration.
 *
 * Checks:
 *   1. STELLAR_NETWORK resolves to testnet/mainnet (public alias allowed).
 *   2. Every configured Horizon URL is a valid http(s) URL, and none points
 *      at the OTHER network's canonical Horizon (a mainnet flag paired with
 *      the testnet Horizon URL — or vice versa — would silently operate on
 *      the wrong chain).
 *   3. The resolved USDC issuer is a valid Stellar public key and matches the
 *      canonical issuer for the selected network (a mainnet flag with a
 *      testnet issuer must not boot).
 *
 * Custom / mirror Horizon URLs are fine — only cross-network mismatches are
 * rejected.
 *
 * @returns {{ valid: boolean, problems: string[] }}
 */
export const validateStellarConfig = () => {
  const problems = [];

  let network;
  try {
    network = resolveStellarNetwork();
  } catch (error) {
    return { valid: false, problems: [error.message] };
  }

  const config = resolveStellarConfig();

  const otherNetwork = network === "mainnet" ? "testnet" : "mainnet";

  for (const url of config.horizonUrls) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      problems.push(
        `Invalid HORIZON_URLS entry "${url}": not a valid URL. ` +
          `Expected http(s) endpoints, comma-separated (e.g. ${HORIZON_DEFAULTS[network]}).`
      );
      continue;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      problems.push(
        `Invalid HORIZON_URLS entry "${url}": must be an http(s) URL.`
      );
    }
    if (url === HORIZON_DEFAULTS[otherNetwork]) {
      problems.push(
        `HORIZON_URLS entry "${url}" is the canonical ${otherNetwork} endpoint, ` +
          `but STELLAR_NETWORK is "${network}". Set HORIZON_URLS to ${HORIZON_DEFAULTS[network]} ` +
          `(or unset it to use the network default) — see docs/MAINNET.md.`
      );
    }
  }

  const expectedIssuer = USDC_ISSUERS[network];
  if (config.usdcIssuer !== expectedIssuer) {
    problems.push(
      `USDC issuer mismatch on ${network}: registry resolves ${config.usdcIssuer}, ` +
        `expected ${expectedIssuer}. Fix src/config/assets.js or the environment — ` +
        "a mainnet flag with a testnet issuer (or vice versa) must never boot."
    );
  } else {
    try {
      StellarSdk.Keypair.fromPublicKey(config.usdcIssuer);
    } catch {
      problems.push(
        `USDC issuer "${config.usdcIssuer}" is not a valid Stellar public key.`
      );
    }
  }

  return { valid: problems.length === 0, problems };
};
