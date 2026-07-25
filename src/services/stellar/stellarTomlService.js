import {
  USDC_ISSUER,
  networkPassphrase,
} from "./stellarService.js";

const CURRENCIES = [
  {
    code: "USDC",
    issuer: USDC_ISSUER,
    status: "live",
    is_asset_anchored: true,
    anchor_asset_type: "fiat",
    anchor_asset: "USD",
    desc: "USD Coin — a regulated stablecoin pegged 1:1 to the US dollar",
    display_decimals: 7,
    name: "USD Coin",
  },
];

const quoteTomlString = (val) => JSON.stringify(String(val));

export function buildStellarToml() {
  const lines = [];

  // ── Header ──
  lines.push(`# DeenBridge Stellar TOML (SEP-1)`);
  lines.push(`VERSION = "2.6.0"`);
  lines.push(`NETWORK_PASSPHRASE = "${networkPassphrase}"`);
  lines.push(``);

  // ── ACCOUNTS ──
  // Use strictly STELLAR_PLATFORM_PUBLIC_KEY; omit ACCOUNTS entirely if unset/blank
  const platformKey = process.env.STELLAR_PLATFORM_PUBLIC_KEY;
  if (platformKey && platformKey.trim() !== "") {
    lines.push(`ACCOUNTS = ["${platformKey.trim()}"]`);
    lines.push(``);
  }

  // ── SEP endpoint hooks ──
  // Emit SIGNING_KEY only if it is a valid public key starting with G; never emit secret seeds or invalid values
  const signingKey = process.env.SIGNING_KEY;
  const isValidPublicKey =
    typeof signingKey === "string" && /^G[A-Z2-7]{55}$/.test(signingKey.trim());

  if (isValidPublicKey) {
    lines.push(`SIGNING_KEY = "${signingKey.trim()}"`);
  } else {
    lines.push(`# SIGNING_KEY = "G..."  # Populated by SEP-10 (#25)`);
  }
  lines.push(`# WEB_AUTH_ENDPOINT = "..."  # Populated by SEP-10 (#25)`);
  lines.push(`# TRANSFER_SERVER_SEP0024 = "..."  # Populated by SEP-24 (#46)`);
  lines.push(``);

  // ── [DOCUMENTATION] — all fields env-driven, block omitted if nothing set ──
  const docFields = [
    ["ORG_NAME", process.env.ORG_NAME],
    ["ORG_URL", process.env.ORG_URL],
    ["ORG_DESCRIPTION", process.env.ORG_DESCRIPTION],
    ["ORG_LOGO", process.env.ORG_LOGO],
    ["ORG_TWITTER", process.env.ORG_TWITTER],
    ["ORG_GITHUB", process.env.ORG_GITHUB],
  ];

  const setDocFields = docFields.filter(([, value]) => value !== undefined && value !== null && value !== "");

  if (setDocFields.length > 0) {
    lines.push(`[DOCUMENTATION]`);
    for (const [key, value] of setDocFields) {
      lines.push(`${key} = ${quoteTomlString(value)}`);
    }
    lines.push(``);
  }

  // ── [[CURRENCIES]] — iterable for future multi-asset support (#18) ──
  for (const currency of CURRENCIES) {
    lines.push(`[[CURRENCIES]]`);
    lines.push(`code = "${currency.code}"`);
    lines.push(`issuer = "${currency.issuer}"`);
    lines.push(`status = "${currency.status}"`);
    lines.push(`is_asset_anchored = ${currency.is_asset_anchored}`);
    lines.push(`anchor_asset_type = "${currency.anchor_asset_type}"`);
    lines.push(`anchor_asset = "${currency.anchor_asset}"`);
    lines.push(`desc = ${quoteTomlString(currency.desc)}`);
    lines.push(`display_decimals = ${currency.display_decimals}`);
    lines.push(`name = ${quoteTomlString(currency.name)}`);
    lines.push(``);
  }

  return lines.join("\n");
}
