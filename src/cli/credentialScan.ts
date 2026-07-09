import type { Command } from 'commander';
import * as fs from 'fs';
import { credentialScan } from '../inventory/credentialScan';
import type { CredentialScanOptions } from '../inventory/credentialScan';
import { parseCredentialCsv } from '../scanner/credentialCsv';
import { parseCredentialIni } from '../scanner/credentialIni';
import { resolveFormat, writeFormattedOutput } from './outputFormat';
import { clearLine, writeProgress } from './progress';

interface CredentialScanOpts {
  file: string;
  timeout: string;
  concurrency: string;
  tls: boolean;
  tlsSkipVerify: boolean;
  json: boolean;
  format?: string;
}

export function registerCredentialScan(program: Command): void {
  program
    .command('credential-scan')
    .description(
      'Scan a known list of hosts from a CSV or INI file, authenticating each with its own username/password',
    )
    .requiredOption(
      '-f, --file <path>',
      'CSV file (host,port,username,password — username and password may be blank; a header row ' +
        'is skipped automatically) or .ini file in the same format Export INI produces (fill in ' +
        'the blank username/password fields first). Format is chosen by file extension.',
    )
    .option('-t, --timeout <ms>', 'connection timeout in milliseconds', '1000')
    .option('--concurrency <n>', 'max concurrent connections', '100')
    .option('--tls', 'attempt TLS first; falls back to plain on handshake failure', false)
    .option('--tls-skip-verify', 'skip TLS certificate verification (self-signed certs)', false)
    .option('--json', 'output results as JSON (shorthand for --format json)', false)
    .option('--format <format>', 'output format: table, json, csv, ini, or xlsx')
    .action(async (opts: CredentialScanOpts) => {
      const format = resolveFormat(opts.format, opts.json);

      let fileText: string;
      try {
        fileText = fs.readFileSync(opts.file, 'utf8');
      } catch (e) {
        process.stderr.write(`Error: could not read ${opts.file}: ${(e as Error).message}\n`);
        process.exit(1);
      }

      const isIni = opts.file.toLowerCase().endsWith('.ini');
      const { rows, errors } = isIni ? parseCredentialIni(fileText) : parseCredentialCsv(fileText);
      for (const err of errors) {
        process.stderr.write(`Warning: ${err}\n`);
      }
      if (rows.length === 0) {
        process.stderr.write(
          `Error: no valid targets found in the ${isIni ? 'INI' : 'CSV'} file.\n`,
        );
        process.exit(1);
      }

      const timeoutMs = Math.max(1, parseInt(opts.timeout, 10) || 1000);
      const concurrency = Math.max(1, parseInt(opts.concurrency, 10) || 100);

      let scanTotal = 0;
      let openCount = 0;

      const scanOpts: CredentialScanOptions = {
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
        results = await credentialScan(
          {
            targets: rows,
            timeoutMs,
            concurrency,
            tls: opts.tls,
            tlsSkipVerify: opts.tlsSkipVerify,
          },
          scanOpts,
        );
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

      writeFormattedOutput(format, results);
    });
}
