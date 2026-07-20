import { estimateHostCount } from './cidr';

/**
 * Total target count (hosts × ports) above which a scan is flagged as
 * "large" and needs an explicit override to run. Distinct from
 * MAX_SCAN_HOSTS (cidr.ts) — that one is an absolute, non-overridable
 * ceiling on host count alone to bound memory/time; this one exists purely
 * to catch likely mistakes (e.g. an oversized port range on a single host,
 * which MAX_SCAN_HOSTS never sees since it only counts hosts) before they
 * run, and can always be bypassed once the user confirms it's intentional.
 */
export const LARGE_SCAN_THRESHOLD = 5000;

export class LargeScanError extends Error {
  readonly totalTargets: number;

  constructor(totalTargets: number) {
    super(
      `This scan targets an estimated ${totalTargets.toLocaleString()} host:port combinations` +
        ` — over the ${LARGE_SCAN_THRESHOLD.toLocaleString()} warning threshold. Re-run with` +
        ` --force to proceed anyway.`,
    );
    this.name = 'LargeScanError';
    this.totalTargets = totalTargets;
  }
}

/** Total targets = hosts × ports for a CIDR/bare-IP/hostname-based scan. */
export function estimateScanTargets(entries: string[], portCount: number): number {
  return estimateHostCount(entries) * portCount;
}

/** Throws LargeScanError when totalTargets exceeds LARGE_SCAN_THRESHOLD, unless force is set. */
export function assertScanNotTooLarge(totalTargets: number, force: boolean): void {
  if (force || totalTargets <= LARGE_SCAN_THRESHOLD) return;
  throw new LargeScanError(totalTargets);
}
