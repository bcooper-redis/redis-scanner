import { scanTargets } from '../scanner/scan';
import { assertScanNotTooLarge } from '../scanner/scanSize';
import { createLimiter } from '../scanner/concurrency';
import type { ScanController } from '../scanner/control';
import { probeHost } from '../probe/index';
import type { ProbeOptions } from '../probe/index';
import { assembleResult } from './assemble';
import { sortWithRunIdGrouping } from '../types';
import type { DiscoveryResult } from '../types';

export interface CredentialTarget {
  host: string;
  port: number;
  /** Blank/absent means no AUTH is attempted for this target. */
  username?: string;
  password?: string;
}

export interface CredentialScanConfig {
  targets: CredentialTarget[];
  timeoutMs: number;
  tls: boolean;
  tlsSkipVerify: boolean;
  concurrency: number;
  /** Bypasses the large-scan warning (see scanner/scanSize.ts). Defaults to false. */
  force?: boolean;
}

export interface CredentialScanOptions {
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
 * Scans an explicit list of known host:port targets, each with its own
 * optional credentials — unlike discover(), which resolves CIDRs/hostnames
 * and cross-joins one shared credential across every target. This is
 * "Credential Scan": you already know exactly which hosts to check (e.g.
 * from a CMDB export) and have a username/password for each, and want
 * inventory plus per-host auth success/failure in one pass.
 *
 * Credentials live only in `config.targets` for the duration of this call —
 * nothing here persists them, matching the same rule the rest of the app
 * follows for the single shared credential in a regular scan.
 */
export async function credentialScan(
  config: CredentialScanConfig,
  options: CredentialScanOptions = {},
): Promise<DiscoveryResult[]> {
  assertScanNotTooLarge(config.targets.length, config.force ?? false);

  // Same host:port listed more than once (e.g. a duplicated CSV row) is
  // scanned exactly once — the last matching row's credentials win — rather
  // than probing and reporting the same target twice.
  const uniqueTargets = new Map<string, CredentialTarget>();
  for (const t of config.targets) {
    uniqueTargets.set(`${t.host}:${t.port}`, t);
  }

  const controller = options.controller;

  const tcpResults = await scanTargets(
    Array.from(uniqueTargets.values(), (t) => ({ host: t.host, port: t.port })),
    {
      timeoutMs: config.timeoutMs,
      concurrency: config.concurrency,
      controller,
      onProgress: options.onScanProgress
        ? (_, done, total) => options.onScanProgress!(done, total)
        : undefined,
    },
  );

  const openPorts = tcpResults.filter((r) => r.open);
  if (openPorts.length === 0) return [];

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

        const target = uniqueTargets.get(`${tcp.host}:${tcp.port}`);
        const credentials = target?.password
          ? { username: target.username, password: target.password }
          : undefined;
        const credentialsProvided = credentials !== undefined;

        const probeOpts: ProbeOptions = {
          tls: config.tls,
          tlsSkipVerify: config.tlsSkipVerify,
          credentials,
        };

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
