import { assertScanSize } from '../scanner/cidr';
import { assertScanNotTooLarge, estimateScanTargets } from '../scanner/scanSize';
import { resolveHosts } from '../scanner/hostname';
import { buildTargets, scanTargets } from '../scanner/scan';
import { createLimiter } from '../scanner/concurrency';
import type { ScanController } from '../scanner/control';
import { probeHost } from '../probe/index';
import type { ProbeOptions } from '../probe/index';
import { assembleResult } from './assemble';
import { sortWithRunIdGrouping } from '../types';
import type { ScanConfig, AuthCredentials, DiscoveryResult } from '../types';

export interface DiscoverOptions {
  credentials?: AuthCredentials;
  /** Fired after each TCP target is scanned. */
  onScanProgress?: (done: number, total: number) => void;
  /** Fired after each open port is probed (Redis or not). */
  onProbeProgress?: (done: number, total: number) => void;
  /** Fired each time a Redis instance is confirmed. */
  onResult?: (result: DiscoveryResult) => void;
  /** When provided, lets a caller pause/resume/stop the scan while it's running. */
  controller?: ScanController;
}

/**
 * Run the full discovery pipeline: resolve targets (CIDRs, bare IPs, and
 * hostnames) → TCP scan → Redis probe → assemble DiscoveryResults. Returns
 * only hosts that responded as Redis. Results are sorted by host then port
 * for deterministic output, except run_id-duplicate groups are kept adjacent
 * (see sortWithRunIdGrouping) so the same database found at more than one
 * endpoint reads as one cluster of rows rather than being scattered.
 */
export async function discover(
  config: ScanConfig,
  options: DiscoverOptions = {},
): Promise<DiscoveryResult[]> {
  assertScanSize(config.cidrs);
  assertScanNotTooLarge(
    estimateScanTargets(config.cidrs, config.ports.length),
    config.force ?? false,
  );
  const hosts = await resolveHosts(config.cidrs, config.timeoutMs);
  const targets = buildTargets(hosts, config.ports);

  const controller = options.controller;

  const tcpResults = await scanTargets(targets, {
    timeoutMs: config.timeoutMs,
    concurrency: config.concurrency,
    controller,
    onProgress: options.onScanProgress
      ? (_, done, total) => options.onScanProgress!(done, total)
      : undefined,
  });

  const openPorts = tcpResults.filter((r) => r.open);
  if (openPorts.length === 0) return [];

  const probeOpts: ProbeOptions = {
    tls: config.tls,
    tlsSkipVerify: config.tlsSkipVerify,
    credentials: options.credentials,
  };
  const credentialsProvided = options.credentials !== undefined;
  const limit = createLimiter(config.concurrency);

  const results: DiscoveryResult[] = [];
  let probeDone = 0;
  const probeTotal = openPorts.length;

  await Promise.all(
    openPorts.map((tcp) =>
      limit(async () => {
        await controller?.waitUntilRunnable();
        if (controller?.isStopped()) {
          options.onProbeProgress?.(++probeDone, probeTotal);
          return;
        }

        // probeHost is documented to always resolve, but a single bad target
        // throwing here would otherwise collapse Promise.all and drop every
        // already-accumulated result in `results`. Contain failures per-target.
        let probe;
        try {
          probe = await probeHost(tcp.host, tcp.port, config.timeoutMs, probeOpts);
        } catch {
          options.onProbeProgress?.(++probeDone, probeTotal);
          return;
        }
        options.onProbeProgress?.(++probeDone, probeTotal);
        if (!probe.isRedis) return;
        try {
          const result = assembleResult(tcp, probe, credentialsProvided);
          results.push(result);
          options.onResult?.(result);
        } catch {
          // one bad target shouldn't drop the rest of the batch
        }
      }),
    ),
  );

  return sortWithRunIdGrouping(results);
}
