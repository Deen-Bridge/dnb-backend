# nginx + ModSecurity WAF (OWASP CRS)

Defense-in-depth layer in front of the Deen Bridge API. The Node.js app already
hardens itself with `helmet`, `express-rate-limit`, `express-mongo-sanitize`,
`hpp` and `xss-clean` (`src/middlewares/security.js`); this nginx layer adds a
Web Application Firewall at the edge so attacks are stopped before they ever
reach Node.

| File | Purpose | Closes |
|------|---------|--------|
| `nginx.conf` | Main reverse proxy: body-size limits per endpoint, WAF wiring, error pages | #254 |
| `websocket.conf` | WebSocket / Socket.io upgrade proxy | #252 |
| `caching.conf` | Static asset `Cache-Control`/`Expires`/ETag policies | #255 |
| `modsecurity.conf` | ModSecurity core config + OWASP CRS (anomaly scoring mode) | #256 |
| `waf-rules.conf` | Custom WAF rules (JSON validation, smuggling, scanners, …) | #256 |
| `waf-exclusions.conf` | Scoped false-positive exclusions + tuning examples | #256 |

---

## Architecture

```
Client ──► nginx (TLS termination, WAF, limits, caching)
              │  ModSecurity + OWASP CRS (anomaly scoring)
              ▼
         Node.js API :5000   (helmet, rate-limit, sanitizers)
```

nginx inspects every request with ModSecurity before proxying. Requests that
accumulate enough anomaly points (default threshold: 5) are rejected with
`403`; hard protocol violations are rejected immediately.

## 1. Install ModSecurity for nginx

The nginx connector is [modsecurity-nginx](https://github.com/owasp-modsecurity/ModSecurity-nginx)
on top of **libmodsecurity v3**. Two options:

### Option A — build a custom nginx (recommended)

```bash
# libmodsecurity v3
git clone --depth 1 https://github.com/owasp-modsecurity/ModSecurity
cd ModSecurity
git submodule update --init --recursive
./build.sh
./configure --prefix=/usr
make -j"$(nproc)" && make install

# nginx connector (dynamic module)
git clone --depth 1 https://github.com/owasp-modsecurity/ModSecurity-nginx
# build with your nginx version:
./configure --add-dynamic-module=../ModSecurity-nginx
make modules
install -m 755 objs/ngx_http_modsecurity_module.so /etc/nginx/modules/
```

Then uncomment in `nginx.conf`:

```nginx
load_module modules/ngx_http_modsecurity_module.so;
```

### Option B — distro packages

Debian/Ubuntu ship `libmodsecurity3` and nginx packages; the connector module
may be available as `libnginx-mod-http-modsecurity`. If not, use Option A.

### Option C — containerised nginx

Use an image that already bundles ModSecurity (e.g. the official
`owasp/modsecurity-crs` nginx image or the Coraza-based alternatives), mount
this directory and the CRS into it, and point `modsecurity_rules_file` at
`/etc/nginx/modsecurity/modsecurity.conf`.

## 2. Install OWASP CRS

The config targets **CRS v4.x** (recommended) and is compatible with **v3.x**
(see notes below). CRS satisfies "v3.x+" from the issue.

```bash
mkdir -p /etc/nginx/modsecurity/crs
cd /etc/nginx/modsecurity/crs
# v4.x (recommended)
curl -sL https://github.com/coreruleset/coreruleset/archive/refs/tags/v4.12.0.tar.gz | tar xz --strip-components=1
# or v3.3.x:
# curl -sL https://github.com/coreruleset/coreruleset/archive/refs/tags/v3.3.7.tar.gz | tar xz --strip-components=1

cp crs-setup.conf.example crs-setup.conf
```

Review `crs-setup.conf` and enable the tuning blocks you need (anomaly
thresholds, paranoia level, allowed methods/content-types). Anomaly scoring is
**enabled by default** — `modsecurity.conf` includes `crs-setup.conf` followed
by `crs/rules/*.conf`, and `waf-rules.conf` re-asserts the thresholds as a
fallback (rule `200008`).

> **CRS v3.x notes**: copy `utils/unicode.mapping` next to `modsecurity.conf`
> and uncomment the `SecUnicodeMapFile` line in `modsecurity.conf`.

## 3. Install the config files

```bash
mkdir -p /etc/nginx/modsecurity /etc/nginx/conf.d
cp nginx/modsecurity.conf    /etc/nginx/modsecurity/
cp nginx/waf-rules.conf      /etc/nginx/modsecurity/
cp nginx/waf-exclusions.conf /etc/nginx/modsecurity/
cp nginx/nginx.conf          /etc/nginx/nginx.conf
cp nginx/websocket.conf      /etc/nginx/conf.d/
cp nginx/caching.conf        /etc/nginx/conf.d/

# make sure audit/tmp paths are writable by the nginx worker
touch /var/log/modsec_audit.log && chown nginx:nginx /var/log/modsec_audit.log

nginx -t && systemctl reload nginx
```

Update the upstream (`server 127.0.0.1:5000;`) and any `root` paths in
`caching.conf` to match your deployment.

## 4. Verify

```bash
# Normal traffic passes
curl -s -o /dev/null -w "%{http_code}\n" http://localhost/health                # 200

# SQLi in the query string -> blocked by CRS (anomaly score)
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost/api/courses?q=1%27%20OR%20%271%27=%271"                     # 403

# XSS payload -> blocked
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost/api/courses" -H 'Content-Type: application/json' \
  -d '{"title":"<script>alert(1)</script>"}'                                    # 403

# Scanner user-agent -> scored, then blocked (anomaly)
curl -s -o /dev/null -w "%{http_code}\n" \
  -A "sqlmap/1.8" "http://localhost/api/courses"                                # 403

# Oversized body -> 413 from nginx before the WAF
head -c 2000000 /dev/zero | tr '\0' 'a' > /tmp/big.txt
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  --data-binary @/tmp/big.txt http://localhost/api/courses                     # 413

# Request smuggling signature -> 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost/api/courses \
  -H 'Transfer-Encoding: chunked' -H 'Content-Length: 5'                        # 400

# WebSocket handshake (if Socket.io is enabled in the app)
curl -s -o /dev/null -w "%{http_code}\n" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: SGVsbG8sIHdvcmxkIQ==" \
  http://localhost/socket.io/?EIO=4\&transport=polling                           # 200
```

Check the audit log for the rule that fired on each blocked request:

```bash
tail -f /var/log/modsec_audit.log
```

## 5. Anomaly scoring mode

OWASP CRS runs in **anomaly scoring** mode (this is how the CRS is designed):

- Every matching rule adds points to `tx.anomaly_score` (default: critical +5,
  warning +4, notice +3, informational +2) instead of blocking immediately.
- At the end of phase 2 the CRS final rules (`949110` inbound / `959100`
  outbound) compare the accumulated score against
  `tx.inbound_anomaly_score_threshold` (default **5**) and block with `403`.
- A single suspicious (but not clearly malicious) signal is therefore *not*
  enough to block a request — several independent signals must agree.

Our custom rules follow the same model: hard violations deny immediately,
ambiguous signals (e.g. scanner user-agents) are scored with `setvar:tx.anomaly_score=+5`.

Tuning knobs live in `crs-setup.conf`:
`tx.inbound_anomaly_score_threshold`, `tx.outbound_anomaly_score_threshold`,
`tx.paranoia_level` (1–4; each level enables stricter sibling rules).

## 6. False-positive tuning

Exclusions live in `waf-exclusions.conf`, already pre-scoped for this app:

| Scope | What is disabled | Why |
|-------|------------------|-----|
| `/health`, `/health/*` | all CRS + custom rules | probes/LB checks trip UA & header rules |
| `/socket.io/` | CRS 920xxx header/content-type policy family | WebSocket upgrades send non-standard headers |
| `multipart/form-data` on uploads | rule `200002` (JSON check), `920410`, `920420` | multipart bodies are not JSON |

Workflow for a new false positive:

1. Switch `SecRuleEngine DetectionOnly` (in `modsecurity.conf`) so nothing is
   blocked while you tune — or grep the audit log for `Matched Rule`.
2. Reproduce the false positive and note the rule id from the audit log.
3. Add a **narrowly scoped** `ctl:ruleRemoveById=<id>` (by path and/or
   content-type) to `waf-exclusions.conf` — never a global removal.
4. Run the verification commands above, then flip `SecRuleEngine On` back on.

The file also contains commented examples for the classic API false positives:
HTML-rich JSON content (941xxx XSS), PHP-injection noise on a Node backend
(932xxx), and SQL keywords in search text (942xxx).

## Security notes

- Keep `SecRuleEngine On` in production. Use `DetectionOnly` only while tuning.
- Raise `tx.paranoia_level` to 2+ for stricter protection once the rule set has
  been running cleanly for a while.
- `SecRequestBodyLimit` (50 MB) intentionally matches the largest
  `client_max_body_size` (50 MB on `/api/uploads`), so the WAF never rejects a
  request nginx would accept.
- This config is the edge layer only — keep the in-app protections
  (`helmet`, rate limiting, sanitizers) enabled; they protect against
  application-level attacks the WAF cannot see.
