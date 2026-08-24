// services/webhooks/urlGuard.js
//
// SSRF guard for outbound webhook targets. Validated at BOTH registration time
// (synchronous, structural checks) and delivery time (DNS resolution in
// production). Rejects non-https (outside development), loopback, RFC-1918
// private ranges, link-local, and other non-routable targets.
//
// RESIDUAL LIMITATION (TOCTOU): DNS is resolved at delivery time, but a
// malicious operator who controls the endpoint's DNS could still rebind the
// hostname to a private address in the window between our resolution and the
// actual socket connect. Fully closing this requires pinning the resolved IP
// onto the connecting socket (custom agent/lookup), which is out of scope
// here. Registration-time literal-IP checks plus delivery-time resolution
// cover the common cases.
import net from "net";
import dns from "dns";

const isDevelopment = () => process.env.NODE_ENV === "development";

/**
 * Classify an IPv4/IPv6 address as private / non-routable and therefore an
 * illegitimate webhook target.
 */
export const isPrivateAddress = (ip) => {
  const family = net.isIP(ip);
  if (family === 4) {
    const parts = ip.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0) return true; // 0.0.0.0/8 "this network"
    if (a === 10) return true; // 10.0.0.0/8
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
    if (a === 192 && b === 168) return true; // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (family === 6) {
    const addr = ip.toLowerCase();
    if (addr === "::1" || addr === "::") return true; // loopback / unspecified
    if (addr.startsWith("fe80")) return true; // link-local
    if (addr.startsWith("fc") || addr.startsWith("fd")) return true; // unique local fc00::/7
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — re-check the embedded v4.
    const mapped = addr.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }
  return false;
};

/**
 * Structural, synchronous validation used at registration time and as a first
 * pass at delivery time. Throws Error with a human-readable message on failure.
 * @returns {URL} the parsed URL
 */
export const validateWebhookUrl = (rawUrl) => {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("Invalid webhook URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Webhook URL must use http or https");
  }

  // https is mandatory everywhere except local development.
  if (url.protocol !== "https:" && !isDevelopment()) {
    throw new Error("Webhook URL must use https");
  }

  const hostname = url.hostname.toLowerCase();
  if (!hostname) {
    throw new Error("Webhook URL must include a host");
  }
  if (hostname === "localhost" || hostname.endsWith(".localhost")) {
    throw new Error("Webhook URL host is not allowed (loopback)");
  }

  // If the host is a literal IP, reject private/non-routable ranges outright —
  // no DNS needed, and enforced in every environment.
  if (net.isIP(hostname) && isPrivateAddress(hostname)) {
    throw new Error("Webhook URL points at a private or non-routable address");
  }

  return url;
};

/**
 * Delivery-time (and production registration-time) check: resolve the hostname
 * and reject if ANY resolved address is private/non-routable. In non-production
 * environments only the structural checks run (DNS is skipped so tests and dev
 * don't depend on network resolution).
 *
 * @returns {Promise<{ ok: boolean, reason?: string }>}
 */
export const assertDeliverableUrl = async (rawUrl) => {
  let url;
  try {
    url = validateWebhookUrl(rawUrl);
  } catch (err) {
    return { ok: false, reason: err.message };
  }

  // Only resolve DNS in production. Elsewhere the structural checks above
  // (including literal-IP rejection) are sufficient and keep the worker
  // offline-testable.
  if (process.env.NODE_ENV !== "production") {
    return { ok: true };
  }

  const hostname = url.hostname.toLowerCase();
  if (net.isIP(hostname)) {
    // Already validated as a public literal above.
    return { ok: true };
  }

  try {
    const records = await dns.promises.lookup(hostname, { all: true });
    for (const { address } of records) {
      if (isPrivateAddress(address)) {
        return {
          ok: false,
          reason: `Resolved address ${address} is private or non-routable`,
        };
      }
    }
  } catch (err) {
    return { ok: false, reason: `DNS resolution failed: ${err.message}` };
  }

  return { ok: true };
};
