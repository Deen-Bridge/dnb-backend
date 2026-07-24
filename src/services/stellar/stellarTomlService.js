import {
  isValidPublicKey,
  NETWORK,
  USDC_ISSUER,
  networkPassphrase,
} from "./stellarService.js";

/**
 * @typedef {Object} StellarTomlConfig
 * @property {string} version
 * @property {string} networkPassphrase
 * @property {string[]} accounts
 * @property {string} [webAuthEndpoint]
 * @property {string} [signingKey]
 * @property {string} [transferServerSep0024]
 * @property {string} [telegramUrl]
 * @property {Record<string, string>} documentation
 * @property {Array<Record<string, string|number|boolean>>} currencies
 */

const valueToToml = (value) => {
  if (Array.isArray(value)) {
    return `[${value.map(valueToToml).join(", ")}]`;
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
};

const appendFields = (lines, fields) => {
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== "" && value !== null) {
      lines.push(`${key} = ${valueToToml(value)}`);
    }
  });
};

/**
 * Build the SEP-1 configuration from environment values and the active
 * Stellar service constants.
 * @returns {StellarTomlConfig}
 */
export const createStellarTomlConfig = (env = process.env) => ({
  version: "2.7.0",
  networkPassphrase,
  accounts: isValidPublicKey(env.STELLAR_PLATFORM_PUBLIC_KEY)
    ? [env.STELLAR_PLATFORM_PUBLIC_KEY]
    : [],
  webAuthEndpoint: env.WEB_AUTH_ENDPOINT,
  signingKey: isValidPublicKey(env.SIGNING_KEY) ? env.SIGNING_KEY : undefined,
  transferServerSep0024: env.TRANSFER_SERVER_SEP0024,
  telegramUrl: env.ORG_TELEGRAM_URL,
  documentation: {
    ORG_NAME: env.ORG_NAME,
    ORG_URL: env.ORG_URL,
    ORG_DESCRIPTION: env.ORG_DESCRIPTION,
    ORG_LOGO: env.ORG_LOGO,
    ORG_GITHUB: env.ORG_GITHUB,
  },
  currencies: [
    {
      code: "USDC",
      issuer: USDC_ISSUER,
      status: NETWORK === "mainnet" ? "live" : "test",
      display_decimals: 2,
      name: "USD Coin",
      desc: "USDC used to settle payments on DeenBridge.",
      is_asset_anchored: true,
      anchor_asset_type: "fiat",
      anchor_asset: "USD",
    },
  ],
});

/**
 * Serialize a typed SEP-1 configuration as TOML.
 * @param {StellarTomlConfig} config
 */
export const buildStellarToml = (config = createStellarTomlConfig()) => {
  const lines = [];

  appendFields(lines, {
    VERSION: config.version,
    NETWORK_PASSPHRASE: config.networkPassphrase,
    ACCOUNTS: config.accounts.length ? config.accounts : undefined,
    WEB_AUTH_ENDPOINT: config.webAuthEndpoint,
    SIGNING_KEY: config.signingKey,
    TRANSFER_SERVER_SEP0024: config.transferServerSep0024,
  });

  lines.push("", "[DOCUMENTATION]");
  appendFields(lines, config.documentation);

  config.currencies.forEach((currency) => {
    lines.push("", "[[CURRENCIES]]");
    appendFields(lines, currency);
  });

  lines.push("");
  if (config.telegramUrl) {
    lines.push(`# Telegram: ${config.telegramUrl}`);
  }
  lines.push(
    "# Set TRANSFER_SERVER_SEP0024 when the SEP-24 service is available.",
    "# Add another [[CURRENCIES]] table here when multi-asset support is enabled.",
    ""
  );

  return lines.join("\n");
};
