import {
  USDC_ISSUER,
  networkPassphrase,
  PLATFORM_WALLET_PUBLIC_KEY,
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

export function buildStellarToml() {
  const lines = [];

  // ── Header ──
  lines.push(`# DeenBridge Stellar TOML (SEP-1)`);
  lines.push(`VERSION = "2.6.0"`);
  lines.push(`NETWORK_PASSPHRASE = "${networkPassphrase}"`);
  lines.push(``);

  // ── ACCOUNTS ──
  const platformKey =
    process.env.STELLAR_PLATFORM_PUBLIC_KEY || PLATFORM_WALLET_PUBLIC_KEY;
  if (platformKey) {
    lines.push(`ACCOUNTS = ["${platformKey}"]`);
    lines.push(``);
  }

  // ── SEP endpoint hooks ──
  const signingKey = process.env.SIGNING_KEY;
  if (signingKey) {
    lines.push(`SIGNING_KEY = "${signingKey}"`);
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

  const setDocFields = docFields.filter(([, value]) => value);

  if (setDocFields.length > 0) {
    lines.push(`[DOCUMENTATION]`);
    for (const [key, value] of setDocFields) {
      lines.push(`${key} = "${value}"`);
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
    lines.push(`desc = "${currency.desc}"`);
    lines.push(`display_decimals = ${currency.display_decimals}`);
    lines.push(`name = "${currency.name}"`);
    lines.push(``);
  }

  return lines.join("\n");
}
