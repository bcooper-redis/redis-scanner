import type { Command } from 'commander';
import { discover } from '../inventory/discover';
import type { DiscoverOptions } from '../inventory/discover';
import { expandPorts } from '../scanner/ports';
import { detectLocalCidrs } from '../scanner/cidr';
import { resolveFormat, writeFormattedOutput, writeDuplicateWarning } from './outputFormat';
import { clearLine, writeProgress } from './progress';
import type { ScanConfig } from '../types';

interface ScanOpts {
  cidr: string[];
  port: string;
  timeout: string;
  concurrency: string;
  tls: boolean;
  tlsSkipVerify: boolean;
  password?: string;
  username?: string;
  json: boolean;
  format?: string;
}

export function registerScan(program: Command): void {
  program
    .command('scan')
    .description('Scan one or more CIDRs for Redis instances')
    .option(
      '-c, --cidr <target>',
      'CIDR, IP, or hostname to scan — repeatable: -c 10.0.0.0/24 -c redis.example.com. ' +
        'Add :port (e.g. redis.example.com:6380) to scan that target on a specific port ' +
        'instead of --port',
      (v: string, acc: string[]) => [...acc, v],
      [] as string[],
    )
    .option('-p, --port <ports>', 'ports to scan, e.g. 6379 or 6379,6380-6385', '6379')
    .option('-t, --timeout <ms>', 'connection timeout in milliseconds', '1000')
    .option('--concurrency <n>', 'max concurrent connections', '100')
    .option('--tls', 'attempt TLS first; falls back to plain on handshake failure', false)
    .option('--tls-skip-verify', 'skip TLS certificate verification (self-signed certs)', false)
    .option('--password <pass>', 'authenticate with this password (never logged or persisted)')
    .option('--username <user>', 'authenticate with this username (ACL; requires --password)')
    .option('--json', 'output results as JSON (shorthand for --format json)', false)
    .option('--format <format>', 'output format: table, json, csv, ini, or xlsx')
    .action(async (opts: ScanOpts) => {
      if (opts.username && !opts.password) {
        process.stderr.write('Error: --username requires --password\n');
        process.exit(1);
      }

      const format = resolveFormat(opts.format, opts.json);

      let cidrs = opts.cidr;
      if (cidrs.length === 0) {
        cidrs = detectLocalCidrs();
        if (cidrs.length === 0) {
          process.stderr.write(
            'Error: no CIDRs specified and none could be auto-detected.\n' +
              'Use -c <cidr> to specify a target, e.g.: rscan scan -c 192.168.1.0/24\n',
          );
          process.exit(1);
        }
        process.stderr.write(`Auto-detected CIDRs: ${cidrs.join(', ')}\n`);
      }

      let ports: number[];
      try {
        ports = expandPorts(opts.port);
      } catch (e) {
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }

      const timeoutMs = Math.max(1, parseInt(opts.timeout, 10) || 1000);
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 100);

      const config: ScanConfig = {
        cidrs,
        ports,
        timeoutMs,
        tls: opts.tls,
        tlsSkipVerify: opts.tlsSkipVerify,
        concurrency,
      };

      const credentials =
        opts.password !== undefined
          ? { username: opts.username, password: opts.password }
          : undefined;

      let scanTotal = 0;
      let openCount = 0;

      const discoverOpts: DiscoverOptions = {
        credentials,
        onScanProgress: (done, total) => {
          scanTotal = total;
          writeProgress(`Scanning... ${done}/${total}`);
        },
        onProbeProgress: (done, total) => {
          openCount = total;
          writeProgress(`Probing ${total} open port${total === 1 ? '' : 's'}... ${done}/${total}`);
        },
      };

      let results;
      try {
        results = await discover(config, discoverOpts);
      } catch (e) {
        clearLine();
        process.stderr.write(`Error: ${(e as Error).message}\n`);
        process.exit(1);
      }

      clearLine();

      const targetStr = `${scanTotal} target${scanTotal === 1 ? '' : 's'}`;
      const openStr = `${openCount} open port${openCount === 1 ? '' : 's'}`;
      const foundStr = `${results.length} Redis instance${results.length === 1 ? '' : 's'}`;
      process.stderr.write(`Scanned ${targetStr}; found ${openStr}, ${foundStr}.\n`);
      writeDuplicateWarning(results);

      writeFormattedOutput(format, results);
    });
}
