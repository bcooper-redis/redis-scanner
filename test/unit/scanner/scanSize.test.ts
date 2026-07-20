import { describe, it, expect } from 'vitest';
import {
  LARGE_SCAN_THRESHOLD,
  LargeScanError,
  estimateScanTargets,
  assertScanNotTooLarge,
} from '../../../src/scanner/scanSize';

describe('estimateScanTargets', () => {
  it('multiplies host count by port count', () => {
    expect(estimateScanTargets(['10.0.0.0/24'], 7)).toBe(254 * 7);
  });

  it('counts a bare IP or hostname as a single host', () => {
    expect(estimateScanTargets(['10.0.0.5', 'redis.example.com'], 3)).toBe(6);
  });

  it('mixes CIDRs and bare hosts in the same total', () => {
    expect(estimateScanTargets(['10.0.0.0/24', '10.0.1.5'], 2)).toBe((254 + 1) * 2);
  });
});

describe('assertScanNotTooLarge', () => {
  it('does not throw at or below the threshold', () => {
    expect(() => assertScanNotTooLarge(LARGE_SCAN_THRESHOLD, false)).not.toThrow();
  });

  it('throws LargeScanError above the threshold', () => {
    expect(() => assertScanNotTooLarge(LARGE_SCAN_THRESHOLD + 1, false)).toThrow(LargeScanError);
  });

  it('reports the exact total in the error message', () => {
    expect(() => assertScanNotTooLarge(10000, false)).toThrow(/10,000/);
  });

  it('carries the total on the error object for structured handling', () => {
    try {
      assertScanNotTooLarge(10000, false);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(LargeScanError);
      expect((e as LargeScanError).totalTargets).toBe(10000);
    }
  });

  it('never throws when force is true, no matter how large', () => {
    expect(() => assertScanNotTooLarge(10_000_000, true)).not.toThrow();
  });
});
