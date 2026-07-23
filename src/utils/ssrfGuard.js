import dns from "dns";
import net from "net";
import logger from "../config/logger.js";

const LOOPBACK_RANGES = [
  "127.0.0.0/8",
  "10.0.0.0/8",
  "172.16.0.0/12",
  "192.168.0.0/16",
  "169.254.0.0/16",
  "::1/128",
  "fc00::/7",
  "fe80::/10",
];

function ipToNumber(ip) {
  if (ip.includes(":")) return null; // IPv6 handled separately
  return ip.split(".").reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function cidrMatch(ip, cidr) {
  const [range, bits] = cidr.split("/");
  const mask = ~(2 ** (32 - parseInt(bits, 10)) - 1) >>> 0;
  return (ipToNumber(ip) & mask) === (ipToNumber(range) & mask);
}

function isPrivateOrLoopback(ip) {
  if (ip === "::1" || ip === "::" || ip === "0.0.0.0") return true;
  if (ip.startsWith("fc") || ip.startsWith("fe")) return true;
  const num = ipToNumber(ip);
  if (num === null) return false;
  return LOOPBACK_RANGES.some((cidr) => cidrMatch(ip, cidr));
}

function isIPv6Loopback(ip) {
  return ip === "::1" || ip === "fe80::1";
}

/**
 * Validate a URL for SSRF safety.
 * - HTTPS required in production
 * - Rejects private/loopback IPs after DNS resolution
 *
 * @param {string} urlString
 * @param {object} [options]
 * @param {boolean} [options.requireHttps=true] - Require HTTPS (defaults to true in production)
 * @returns {Promise<{ valid: boolean, error?: string }>}
 */
export async function validateEndpointUrl(urlString, options = {}) {
  const { requireHttps = process.env.NODE_ENV === "production" } = options;

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch {
    return { valid: false, error: "Invalid URL format" };
  }

  if (requireHttps && parsed.protocol !== "https:") {
    return { valid: false, error: "Endpoint URL must use HTTPS in production" };
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return { valid: false, error: "URL must use http or https protocol" };
  }

  // Only check private IPs in production
  if (process.env.NODE_ENV === "production") {
    const hostname = parsed.hostname;

    // Skip DNS resolution for IP literals
    const ipNum = ipToNumber(hostname);
    if (ipNum !== null) {
      if (isPrivateOrLoopback(hostname)) {
        return { valid: false, error: "Endpoint URL must not target private or loopback addresses" };
      }
    } else {
      try {
        const addrs = await dns.promises.resolve4(hostname);
        for (const addr of addrs) {
          if (isPrivateOrLoopback(addr)) {
            return { valid: false, error: "Endpoint URL resolves to a private or loopback address" };
          }
        }
      } catch {
        // DNS resolution failure is not an SSRF issue — the URL is just invalid
        return { valid: false, error: "Could not resolve endpoint hostname" };
      }
    }
  }

  return { valid: true };
}
