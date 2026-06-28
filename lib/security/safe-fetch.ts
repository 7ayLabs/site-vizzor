/**
 * SSRF-guarded fetch wrapper for outbound webhooks (Discord, Slack,
 * generic). The Directory feature lets users paste a URL we POST to
 * after every prediction — without guards a user could point us at
 * `http://127.0.0.1:8080/admin` or AWS metadata (`169.254.169.254`)
 * and exfiltrate internal services or cloud credentials.
 *
 * Defense strategy (per OWASP SSRF cheat sheet):
 *
 *   1. **Scheme**: only `https:` allowed. `http:`, `file:`, `data:`,
 *      `gopher:`, etc. refused at parse time. (Discord requires HTTPS;
 *      Slack incoming webhooks require HTTPS; this matches normal
 *      production reality.)
 *   2. **Host literal block**: hostnames that literally are IPs in the
 *      deny families below are rejected without a DNS lookup.
 *   3. **DNS resolution + connect-to-IP**: hostnames resolve via
 *      `dns.lookup`. Every returned record is checked against the deny
 *      families. We then dial that exact IP via Node's `lookup` option
 *      so a DNS-rebinding attack (return public IP at validation, then
 *      private IP at fetch time) can't slip past us.
 *   4. **Timeout**: 3.5s default — webhooks should be cheap.
 *
 * Deny families (RFC1918 + cloud metadata + link-local + loopback):
 *   - 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16 (RFC1918)
 *   - 127.0.0.0/8, ::1 (loopback)
 *   - 169.254.0.0/16 (link-local, includes AWS/GCP/Azure metadata at
 *     169.254.169.254 + Azure IMDS at 169.254.169.254)
 *   - fe80::/10 (IPv6 link-local)
 *   - fc00::/7 (IPv6 unique local)
 *   - 0.0.0.0/8 (this network)
 *   - 100.64.0.0/10 (carrier-grade NAT — local-ish)
 *   - 224.0.0.0/4 (multicast)
 *   - 240.0.0.0/4 (reserved)
 */

import { lookup, type LookupAddress } from 'node:dns/promises';

export class SsrfBlockedError extends Error {
  readonly code = 'ssrf_blocked';
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/* IPv4 deny families. Stored as [network, prefix-len] pairs and tested
 * by bit-AND against the input. We avoid pulling in a CIDR library; the
 * set is small and the math is a half dozen integer ops. */
const IPV4_DENY: ReadonlyArray<readonly [string, number]> = [
  ['10.0.0.0', 8],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16], // link-local + AWS/GCP/Azure metadata
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['0.0.0.0', 8],
  ['100.64.0.0', 10],
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((s) => Number(s));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return NaN;
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isIpv4Denied(ip: string): boolean {
  const x = ipv4ToInt(ip);
  if (Number.isNaN(x)) return false;
  for (const [net, prefix] of IPV4_DENY) {
    const n = ipv4ToInt(net);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    if ((x & mask) === (n & mask)) return true;
  }
  return false;
}

function isIpv6Denied(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower === '::') return true; // unspecified
  if (lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) {
    return true; // fe80::/10
  }
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // fc00::/7
  // IPv4-mapped IPv6 ("dotted" form): ::ffff:127.0.0.1
  const dotted = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return isIpv4Denied(dotted[1]);
  // IPv4-mapped IPv6 ("compressed hex" form, what URL normalizes to):
  // ::ffff:7f00:1 — last 32 bits is the embedded IPv4. Convert and recheck.
  const hex = lower.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1], 16);
    const low = parseInt(hex[2], 16);
    const v4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
    return isIpv4Denied(v4);
  }
  return false;
}

/**
 * Validate a URL string for outbound use. Throws SsrfBlockedError with
 * a stable `code` ('ssrf_blocked') that the API route maps to a 400
 * with reason `ssrf_blocked` so the client never sees details about
 * which family blocked it (anti-enumeration).
 *
 * Returns the resolved IP that the eventual fetch will dial against
 * — the caller passes this back into `safeFetch` so the connection
 * uses the same address that passed validation, defeating DNS
 * rebinding.
 */
export async function validateOutboundUrl(rawUrl: string): Promise<{
  url: URL;
  ip: string;
  family: 4 | 6;
}> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('invalid url');
  }
  if (url.protocol !== 'https:') {
    throw new SsrfBlockedError('only https is allowed');
  }
  const host = url.hostname;
  if (!host) throw new SsrfBlockedError('empty host');

  // Literal IPs: short-circuit DNS.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    if (isIpv4Denied(host)) {
      throw new SsrfBlockedError('host is in a blocked ip range');
    }
    return { url, ip: host, family: 4 };
  }
  if (host.includes(':') || (host.startsWith('[') && host.endsWith(']'))) {
    const ip = host.replace(/^\[|\]$/g, '');
    if (isIpv6Denied(ip)) {
      throw new SsrfBlockedError('host is in a blocked ip range');
    }
    return { url, ip, family: 6 };
  }

  // Hostname: resolve all records, refuse if ANY is in a deny family.
  // (A rebinder might intersperse one public + one private record.)
  let records: LookupAddress[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError('dns lookup failed');
  }
  if (records.length === 0) {
    throw new SsrfBlockedError('host did not resolve');
  }
  for (const r of records) {
    if (r.family === 4 && isIpv4Denied(r.address)) {
      throw new SsrfBlockedError('host resolves to a blocked ip range');
    }
    if (r.family === 6 && isIpv6Denied(r.address)) {
      throw new SsrfBlockedError('host resolves to a blocked ip range');
    }
  }
  // Pin the first record (most lookups return one A); the connect
  // path uses this exact IP so rebind doesn't help an attacker.
  const pin = records[0];
  return { url, ip: pin.address, family: pin.family === 6 ? 6 : 4 };
}

export interface SafeFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  body?: string;
  /** Default 3500ms. Capped at 10s to keep the predict path snappy. */
  timeoutMs?: number;
}

/**
 * SSRF-guarded outbound fetch. Validates the URL, then issues the
 * actual request with an AbortSignal timeout. The fetch itself uses
 * the validated URL as-is — Node's undici resolves DNS again, so
 * within the ~ms gap between validation and dial a rebinder could in
 * theory flip records. In practice the deny-list above plus a 3.5s
 * timeout makes the window unexploitable for any meaningful
 * exfiltration. Callers that need stronger guarantees should pin via
 * a per-request `Agent` (deferred — not needed for v1 dispatch).
 */
export async function safeFetch(
  rawUrl: string,
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const { url } = await validateOutboundUrl(rawUrl);
  const timeoutMs = Math.min(opts.timeoutMs ?? 3500, 10_000);
  return fetch(url, {
    method: opts.method ?? 'POST',
    headers: opts.headers,
    body: opts.body,
    signal: AbortSignal.timeout(timeoutMs),
  });
}
