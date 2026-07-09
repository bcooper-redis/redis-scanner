import { formatTable, formatJson, formatDuplicateWarning } from './format';
import { toCsv, toIni, toOsstatsXlsx } from '../export/index';
import type { DiscoveryResult } from '../types';

export type OutputFormat = 'table' | 'json' | 'csv' | 'ini' | 'xlsx';

const VALID_FORMATS: OutputFormat[] = ['table', 'json', 'csv', 'ini', 'xlsx'];

/**
 * Resolves --format/--json into a single OutputFormat. --json is a
 * back-compat alias for --format json; an explicit --format always wins if
 * both are given. Exits with an error on an unrecognized --format value.
 */
export function resolveFormat(formatOpt: string | undefined, jsonFlag: boolean): OutputFormat {
  if (formatOpt === undefined) {
    return jsonFlag ? 'json' : 'table';
  }
  if (!VALID_FORMATS.includes(formatOpt as OutputFormat)) {
    process.stderr.write(
      `Error: invalid --format "${formatOpt}" (expected one of: ${VALID_FORMATS.join(', ')})\n`,
    );
    process.exit(1);
  }
  return formatOpt as OutputFormat;
}

/**
 * Writes a stderr warning when 2+ results share a run_id, regardless of
 * --format — unlike stdout, stderr is unaffected by piping/redirecting the
 * result data, so this is the one place a duplicate warning always surfaces.
 */
export function writeDuplicateWarning(results: DiscoveryResult[]): void {
  const warning = formatDuplicateWarning(results);
  if (warning) process.stderr.write(`\n${warning}\n`);
}

/** Writes results to stdout in the given format. XLSX is binary; every other format is text. */
export function writeFormattedOutput(format: OutputFormat, results: DiscoveryResult[]): void {
  switch (format) {
    case 'json':
      process.stdout.write(formatJson(results) + '\n');
      break;
    case 'csv':
      process.stdout.write(toCsv(results));
      break;
    case 'ini':
      process.stdout.write(toIni(results));
      break;
    case 'xlsx':
      process.stdout.write(toOsstatsXlsx(results));
      break;
    case 'table':
      process.stdout.write(formatTable(results) + '\n');
      break;
  }
}
