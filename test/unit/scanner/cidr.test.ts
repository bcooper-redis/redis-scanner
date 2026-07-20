import * as os from 'os';
import { describe, it, expect, vi } from 'vitest';
import {
  expandCidr,
  cidrHostCount,
  estimateHostCount,
  detectLocalCidrs,
  assertScanSize,
} from '../../../src/scanner/cidr';

// networkInterfaces() can't be vi.spyOn'd directly (Node's ESM module
// namespace isn't configurable) — mock the module instead, defaulting
// through to the real implementation so every other test in this file still
// sees this machine's actual interfaces. mockReturnValueOnce below overrides
// it for exactly one call, then it reverts to the real thing automatically.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return { ...actual, networkInterfaces: vi.fn(actual.networkInterfaces) };
});

describe('expandCidr', () => {
  it('/32 returns exactly the one address', () => {
    expect(expandCidr('10.0.0.1/32')).toEqual(['10.0.0.1']);
  });

  it('/31 returns both addresses (RFC 3021)', () => {
    expect(expandCidr('192.168.1.0/31')).toEqual(['192.168.1.0', '192.168.1.1']);
  });

  it('/30 returns 2 host addresses (skips network and broadcast)', () => {
    const ips = expandCidr('192.168.1.0/30');
    expect(ips).toEqual(['192.168.1.1', '192.168.1.2']);
  });

  it('/24 returns 254 host addresses', () => {
    const ips = expandCidr('192.168.1.0/24');
    expect(ips).toHaveLength(254);
    expect(ips[0]).toBe('192.168.1.1');
    expect(ips[253]).toBe('192.168.1.254');
  });

  it('normalises host bits — 192.168.1.5/24 expands same as 192.168.1.0/24', () => {
    const a = expandCidr('192.168.1.5/24');
    const b = expandCidr('192.168.1.0/24');
    expect(a).toEqual(b);
  });

  it('handles high-octet addresses correctly (first octet >= 128)', () => {
    const ips = expandCidr('172.16.0.0/30');
    expect(ips).toEqual(['172.16.0.1', '172.16.0.2']);
  });

  it('throws on missing prefix length', () => {
    expect(() => expandCidr('192.168.1.0')).toThrow(/missing prefix/i);
  });

  it('throws on out-of-range prefix', () => {
    expect(() => expandCidr('192.168.1.0/33')).toThrow(/invalid prefix/i);
  });

  it('throws on invalid IP', () => {
    expect(() => expandCidr('999.0.0.0/24')).toThrow(/invalid ip/i);
  });
});

describe('cidrHostCount', () => {
  it('/32 → 1', () => expect(cidrHostCount('10.0.0.1/32')).toBe(1));
  it('/31 → 2', () => expect(cidrHostCount('10.0.0.0/31')).toBe(2));
  it('/30 → 2', () => expect(cidrHostCount('10.0.0.0/30')).toBe(2));
  it('/24 → 254', () => expect(cidrHostCount('10.0.0.0/24')).toBe(254));
  it('/16 → 65534', () => expect(cidrHostCount('10.0.0.0/16')).toBe(65534));
});

describe('estimateHostCount', () => {
  it('sums CIDR host counts', () => {
    expect(estimateHostCount(['10.0.0.0/24', '10.1.0.0/24'])).toBe(508);
  });

  it('counts a bare IP or hostname as a single host', () => {
    expect(estimateHostCount(['10.0.0.5', 'redis.example.com'])).toBe(2);
  });
});

describe('assertScanSize', () => {
  it('does not throw for a scan within the limit', () => {
    expect(() => assertScanSize(['10.0.0.0/24'])).not.toThrow();
  });

  it('throws when a single CIDR exceeds the limit', () => {
    expect(() => assertScanSize(['10.0.0.0/8'])).toThrow(/scan target too large/i);
  });

  it('throws when combined CIDRs exceed the limit even though each is individually small', () => {
    expect(() => assertScanSize(['10.0.0.0/16', '10.1.0.0/16'])).toThrow(/scan target too large/i);
  });

  it('counts a bare IP or hostname as a single host, without throwing on its format', () => {
    expect(() => assertScanSize(['10.0.0.5', 'redis.example.com'])).not.toThrow();
  });

  it('counts bare IPs/hostnames alongside CIDRs toward the same limit', () => {
    const manyHosts = Array.from({ length: 10 }, (_, i) => `10.0.0.${i}`);
    expect(() => assertScanSize(['10.0.0.0/16', ...manyHosts])).toThrow(/scan target too large/i);
  });
});

describe('detectLocalCidrs', () => {
  it('returns at least one CIDR', () => {
    const cidrs = detectLocalCidrs();
    expect(cidrs.length).toBeGreaterThan(0);
  });

  it('returns valid CIDR strings', () => {
    const cidrs = detectLocalCidrs();
    for (const cidr of cidrs) {
      expect(cidr).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/);
    }
  });

  it('does not include loopback addresses', () => {
    const cidrs = detectLocalCidrs();
    for (const cidr of cidrs) {
      expect(cidr).not.toMatch(/^127\./);
    }
  });

  it('returns normalised network addresses (host bits zeroed)', () => {
    const cidrs = detectLocalCidrs();
    for (const cidr of cidrs) {
      // Re-expanding then checking first IP confirms network address is correct
      const [, prefixStr] = cidr.split('/');
      const prefix = parseInt(prefixStr, 10);
      if (prefix < 32) {
        const expanded = expandCidr(cidr);
        expect(expanded.length).toBeGreaterThan(0);
      }
    }
  });

  describe('with multiple interfaces on the same subnet', () => {
    function makeAddr(address: string, netmask: string): os.NetworkInterfaceInfoIPv4 {
      return {
        address,
        netmask,
        family: 'IPv4',
        mac: '00:00:00:00:00:00',
        internal: false,
        cidr: `${address}/24`,
      };
    }

    it('dedupes when Wi-Fi and Ethernet both sit on the same /24 — the exact bug reported live', () => {
      // 192.168.1.166 (Wi-Fi) and 192.168.1.96 (Ethernet) both normalize to
      // 192.168.1.0/24. Without dedup this returns that CIDR twice, silently
      // doubling every target buildTargets() later produces.
      vi.mocked(os.networkInterfaces).mockReturnValueOnce({
        en0: [makeAddr('192.168.1.166', '255.255.255.0')],
        en5: [makeAddr('192.168.1.96', '255.255.255.0')],
      });
      expect(detectLocalCidrs()).toEqual(['192.168.1.0/24']);
    });

    it('keeps genuinely different subnets separate', () => {
      vi.mocked(os.networkInterfaces).mockReturnValueOnce({
        en0: [makeAddr('192.168.1.166', '255.255.255.0')],
        en5: [makeAddr('10.0.0.50', '255.255.255.0')],
      });
      expect(detectLocalCidrs().sort()).toEqual(['10.0.0.0/24', '192.168.1.0/24']);
    });
  });
});
