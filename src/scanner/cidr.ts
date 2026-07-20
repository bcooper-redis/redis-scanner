import * as os from 'os';

function ipToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    throw new Error(`Invalid IP address: ${ip}`);
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function prefixToMask(prefix: number): number {
  return prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
}

function netmaskToPrefix(netmask: string): number {
  return netmask
    .split('.')
    .map(Number)
    .reduce((acc, octet) => {
      let n = octet;
      let count = 0;
      while (n) {
        count += n & 1;
        n >>>= 1;
      }
      return acc + count;
    }, 0);
}

/**
 * Expand a CIDR string into the list of scannable host IP addresses.
 *
 * - /32  → the single address
 * - /31  → both addresses (RFC 3021 point-to-point)
 * - rest → all addresses between network+1 and broadcast-1
 */
export function expandCidr(cidr: string): string[] {
  const slash = cidr.indexOf('/');
  if (slash === -1) {
    throw new Error(`Invalid CIDR (missing prefix length): ${cidr}`);
  }

  const base = cidr.slice(0, slash);
  const prefix = parseInt(cidr.slice(slash + 1), 10);

  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid prefix length in CIDR: ${cidr}`);
  }

  const baseInt = ipToInt(base);

  if (prefix === 32) {
    return [intToIp(baseInt)];
  }

  const mask = prefixToMask(prefix);
  const network = (baseInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  if (prefix === 31) {
    return [intToIp(network), intToIp(broadcast)];
  }

  const ips: string[] = [];
  for (let i = network + 1; i < broadcast; i++) {
    ips.push(intToIp(i >>> 0));
  }
  return ips;
}

/**
 * Return the number of host addresses in a CIDR without expanding it.
 * Useful for size checks before committing to a full expansion.
 */
export function cidrHostCount(cidr: string): number {
  const prefix = parseInt(cidr.split('/')[1] ?? '', 10);
  if (isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }
  if (prefix === 32) return 1;
  if (prefix === 31) return 2;
  return Math.pow(2, 32 - prefix) - 2;
}

/** Maximum combined host count across all CIDRs in a single scan request. */
export const MAX_SCAN_HOSTS = 65536;

/**
 * Estimated host count across CIDRs, bare IPs, and hostnames, without
 * expanding any entry into its actual address list. Bare IPs/hostnames each
 * count as a single host — a hostname's real fan-out isn't known until it's
 * actually resolved, but DNS records realistically return a small handful of
 * addresses at most, nothing like a mistyped wide CIDR.
 */
export function estimateHostCount(entries: string[]): number {
  return entries.reduce((sum, entry) => sum + (entry.includes('/') ? cidrHostCount(entry) : 1), 0);
}

/**
 * Throws if the combined host count across all entries would exceed
 * MAX_SCAN_HOSTS, so a wide range (e.g. /8 or /0) can't force an unbounded
 * in-memory host×port expansion before scanning even starts. This is an
 * absolute, non-overridable ceiling to bound memory/time regardless of
 * intent — see scanSize.ts's assertScanNotTooLarge for the separate,
 * overridable "did you mean to scan this many targets" warning.
 */
export function assertScanSize(entries: string[]): void {
  const total = estimateHostCount(entries);
  if (total > MAX_SCAN_HOSTS) {
    throw new Error(
      `Scan target too large: ${total} hosts requested across ${entries.length} target(s) ` +
        `(max ${MAX_SCAN_HOSTS}). Use a smaller or more specific range.`,
    );
  }
}

/**
 * Return a normalised CIDR for each non-loopback IPv4 interface,
 * capped at /24 so auto-detect never generates more than 254 targets per interface.
 *
 * Deduplicated: a machine with two interfaces on the same subnet (e.g. Wi-Fi
 * and Ethernet both on 192.168.1.0/24) would otherwise compute the identical
 * resulting CIDR twice, silently doubling every target in the scan.
 */
export function detectLocalCidrs(): string[] {
  const interfaces = os.networkInterfaces();
  const cidrs = new Set<string>();

  for (const iface of Object.values(interfaces)) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family !== 'IPv4' || addr.internal) continue;

      const actualPrefix = netmaskToPrefix(addr.netmask);
      const effectivePrefix = Math.max(actualPrefix, 24);
      const mask = prefixToMask(effectivePrefix);
      const networkInt = (ipToInt(addr.address) & mask) >>> 0;
      cidrs.add(`${intToIp(networkInt)}/${effectivePrefix}`);
    }
  }

  return Array.from(cidrs);
}
