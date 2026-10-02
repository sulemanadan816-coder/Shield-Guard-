/**
 * URL and domain helpers. Deliberately conservative: we never build
 * wildcard-style matching that could accidentally cover unrelated domains
 * (e.g. "example.com" must never match "notexample.com" or
 * "example.com.evil.net").
 */

/**
 * A small, explicit list of multi-part public suffixes we special-case so
 * "co.uk", "com.au" etc. resolve to a sensible registrable domain. This is
 * intentionally NOT a full Public Suffix List implementation (that would
 * require bundling/updating a large third-party dataset); for the small
 * set of suffixes below we get correct eTLD+1 behavior, and for everything
 * else we fall back to "last two labels", which is correct for the vast
 * majority of real-world domains.
 */
const KNOWN_MULTI_LABEL_SUFFIXES = new Set([
  "co.uk", "org.uk", "gov.uk", "ac.uk", "me.uk",
  "com.au", "net.au", "org.au",
  "co.jp", "co.in", "co.nz", "com.br", "com.mx",
  "co.za", "com.sg"
]);

export function isValidHostname(host: string): boolean {
  if (!host) return false;
  if (host.length > 253) return false;
  // Reject obviously malformed input without throwing.
  return /^[a-z0-9.-]+$/i.test(host);
}

export function isIpAddress(host: string): boolean {
  const ipv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4.test(host)) {
    return host.split(".").every((seg) => Number(seg) <= 255);
  }
  // Very loose IPv6 literal check (host may arrive bracketed or not).
  const stripped = host.replace(/^\[/, "").replace(/\]$/, "");
  return /^[0-9a-f:]+$/i.test(stripped) && stripped.includes(":");
}

/**
 * Returns the registrable domain (eTLD+1) for a hostname, or the original
 * host unchanged if it's an IP address, "localhost", or otherwise not a
 * multi-label DNS name.
 */
export function getRegistrableDomain(hostname: string): string {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!isValidHostname(host) || isIpAddress(host) || host === "localhost") {
    return host;
  }
  const labels = host.split(".");
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join(".");
  const lastThree = labels.slice(-3).join(".");
  if (KNOWN_MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return lastThree;
  }
  return lastTwo;
}

export function safeParseUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function getHostname(input: string): string | null {
  const url = safeParseUrl(input);
  return url ? url.hostname.toLowerCase() : null;
}

/**
 * True if `candidate` is exactly `domain` or a strict subdomain of it
 * (e.g. domain="example.com" matches "example.com" and "shop.example.com",
 * but never "notexample.com" or "example.com.evil.net").
 */
export function isSameOrSubdomain(candidate: string, domain: string): boolean {
  const c = candidate.toLowerCase().replace(/\.$/, "");
  const d = domain.toLowerCase().replace(/\.$/, "");
  return c === d || c.endsWith(`.${d}`);
}

export function isCrossOrigin(originA: string, originB: string): boolean {
  const a = getHostname(originA);
  const b = getHostname(originB);
  if (!a || !b) return true;
  return getRegistrableDomain(a) !== getRegistrableDomain(b);
}
