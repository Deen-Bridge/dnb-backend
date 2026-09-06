# SEP-24 Anchor Integration

Non-custodial fiat on/off-ramp for USDC via Stellar SEP-24 (interactive
deposit/withdrawal), relayed through SEP-10 (web authentication) and
SEP-1 (`stellar.toml` discovery).

## Trust model

This integration is strictly non-custodial. The backend never holds a
Stellar secret key and never signs a transaction on the user's behalf.

- **Wallet keys never leave the browser.** Every transaction the backend
  builds (the SEP-10 challenge relay, the trustline `changeTrust` operation)
  is returned to the client as **unsigned XDR**. The user's wallet signs it
  client-side; the backend only ever sees the signed result, exactly like
  the existing `paymentController.js` build → sign → submit flow.
- **Anchor JWTs are the one server-held credential**, and they are not
  Stellar keys - they're bearer tokens for the user's session with a
  specific anchor, structurally similar to a cookie. They're:
  - stored in Redis only, keyed by `anchor:jwt:{userId}:{homeDomain}`,
    with the Redis key's own TTL set from the JWT's `exp` claim (so it
    disappears from storage the moment it would have expired anyway);
  - never included in any API response body, header, or log line
    (test-proven in `test/anchorJwtCustody.test.js`);
  - never verified with an anchor's private key (we don't have one) - only
    decoded to read `exp`. Trust in the JWT's authenticity comes from having
    obtained it directly from the anchor's HTTPS endpoint immediately after
    a validated SEP-10 challenge, not from a local signature check.
- **The SEP-10 challenge is fully validated server-side before it is ever
  handed to the client for signing.** A challenge that fails validation
  (wrong sequence number, not signed by the anchor's published `SIGNING_KEY`,
  wrong network, wrong home domain, or issued for a different account) is
  rejected with a 502 and nothing resembling the challenge is returned. See
  the rejection matrix in `test/anchorAuth.test.js`.
- **The USDC issuer is cross-checked, never trusted from the anchor alone.**
  Before any anchor is used, its self-reported `stellar.toml` currency entry
  for USDC must have an issuer matching the platform's own `USDC_ISSUER`
  constant (`src/services/stellar/stellarService.js`). A mismatch is refused
  outright, regardless of anything else the anchor claims.

## Allowlisting

Only anchors on the `ANCHOR_HOME_DOMAINS` allowlist are ever contacted -
including for `stellar.toml` resolution. A request for a non-allowlisted
domain is rejected with `403` before any network call is made.

```
# .env
ANCHOR_HOME_DOMAINS=testanchor.stellar.org,anchor.example.com
ANCHOR_TOML_CACHE_TTL=3600
```

- `ANCHOR_HOME_DOMAINS` is a comma-separated list of bare domains (no
  scheme). On testnet it defaults to `testanchor.stellar.org` if left unset;
  on mainnet it is empty by default and the whole anchor feature returns
  `503` until an operator explicitly opts in.
- `ANCHOR_TOML_CACHE_TTL` controls how long a resolved `stellar.toml` is
  cached (seconds). Redis-backed; if Redis is unavailable the cache
  silently no-ops and each request resolves fresh, same as every other
  cache use in this codebase.

### Adding a mainnet anchor

1. Confirm the anchor is SEP-1/SEP-10/SEP-24 compliant and publishes a
   `stellar.toml` with `TRANSFER_SERVER_SEP0024`, `WEB_AUTH_ENDPOINT`, and
   `SIGNING_KEY`.
2. Confirm its published USDC `CURRENCIES` entry uses the same issuer as
   this platform's `USDC_ISSUER` (mainnet:
   `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`). If it
   doesn't, the integration will refuse the anchor automatically - this
   isn't configurable, by design.
3. Add the anchor's bare domain to `ANCHOR_HOME_DOMAINS` in production
   config and redeploy. No code change is required.

## API flow

1. `GET /api/stellar/anchor/info?homeDomain=...` - resolve and validate an
   anchor, returning its deposit/withdraw limits and fees.
2. `POST /api/stellar/anchor/auth/challenge` `{ homeDomain }` - fetch and
   fully validate a SEP-10 challenge; returns unsigned XDR for the wallet to
   sign.
3. `POST /api/stellar/anchor/auth/verify` `{ homeDomain, signedXdr }` -
   submit the signed challenge; the anchor's JWT is stored server-side and
   never returned.
4. `POST /api/stellar/anchor/deposits` / `POST /api/stellar/anchor/withdrawals`
   `{ homeDomain }` - starts a SEP-24 interactive flow using the stored JWT;
   returns the anchor's interactive `url` and `id`. Deposit responses also
   include an unsigned `trustlineXdr` (a `changeTrust` operation) if the
   user's wallet doesn't yet hold a USDC trustline - sign and submit this
   before or alongside the deposit.
5. `GET /api/stellar/anchor/transactions` / `GET /api/stellar/anchor/transactions/:id` -
   the user's own anchor transaction records, refreshed live from the anchor
   on read if stale. A background poller also refreshes non-terminal
   records independently (`src/jobs/anchorPoller.js`).

Anchor-reported statuses are stored and returned **verbatim** - the full
SEP-24 vocabulary (`incomplete`, `pending_user_transfer_start`,
`pending_anchor`, `pending_stellar`, `completed`, `error`, etc.), not a
collapsed subset.

## Testnet demo script

Uses Stellar's public test anchor, `testanchor.stellar.org`, which is the
default allowlisted domain on testnet.

```bash
# 1. Connect a testnet wallet (see walletController.connectWallet) and log in
#    to get an access token, then:

# 2. Resolve the anchor
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:5000/api/stellar/anchor/info?homeDomain=testanchor.stellar.org"

# 3. Get a SEP-10 challenge
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"homeDomain":"testanchor.stellar.org"}' \
  http://localhost:5000/api/stellar/anchor/auth/challenge
# -> sign the returned XDR with your wallet's secret key, client-side

# 4. Submit the signed challenge to establish a session
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"homeDomain":"testanchor.stellar.org","signedXdr":"<signed XDR>"}' \
  http://localhost:5000/api/stellar/anchor/auth/verify

# 5. Start a deposit
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"homeDomain":"testanchor.stellar.org"}' \
  http://localhost:5000/api/stellar/anchor/deposits
# -> open the returned `url` in a browser to complete the anchor's KYC/deposit
#    flow. If a `trustlineXdr` was returned, sign and submit it first.

# 6. Poll status (or wait for the background poller)
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/stellar/anchor/transactions
```
