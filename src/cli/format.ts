import { productDisplay, findRunIdDuplicates } from '../types';
import type { DiscoveryResult, MemoryInfo } from '../types';

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

// maxMemoryBytes null means "no limit" (see parseMemory in probe/info.ts) —
// distinct from usedMemoryBytes null, which means "unknown".
function formatMemory(memory: MemoryInfo | undefined): string {
  if (!memory) return '—';
  const max = memory.maxMemoryBytes != null ? formatBytes(memory.maxMemoryBytes) : 'no limit';
  return `${formatBytes(memory.usedMemoryBytes)} / ${max}`;
}

function authDisplay(r: DiscoveryResult): string {
  if (r.anonymousStatus === 'open') {
    return r.authenticatedStatus === 'authenticated' ? 'authed' : 'open';
  }
  if (r.anonymousStatus === 'auth_required') {
    if (r.authenticatedStatus === 'authenticated') return 'authed';
    if (r.authenticatedStatus === 'auth_failed') return 'wrong pw';
    return 'required';
  }
  return 'error';
}

type Row = {
  host: string;
  port: string;
  tls: string;
  product: string;
  version: string;
  auth: string;
  role: string;
  memory: string;
  latency: string;
};

const HEADERS: Row = {
  host: 'HOST',
  port: 'PORT',
  tls: 'TLS',
  product: 'PRODUCT',
  version: 'VERSION',
  auth: 'AUTH',
  role: 'ROLE',
  memory: 'MEMORY',
  latency: 'LATENCY',
};

const KEYS = Object.keys(HEADERS) as (keyof Row)[];

function toRow(r: DiscoveryResult): Row {
  return {
    host: r.host,
    port: String(r.port),
    tls: r.tls ? 'yes' : 'no',
    product: productDisplay(r.product),
    version: r.version ?? '—',
    auth: authDisplay(r),
    role: r.inventory?.role ?? '—',
    memory: formatMemory(r.inventory?.memory),
    latency: `${r.latency}ms`,
  };
}

/**
 * Warns when 2+ results share a run_id — the same running redis-server
 * process reachable through more than one host:port (e.g. a Redis
 * Enterprise database answering on every cluster node behind its proxy).
 * Returns '' when there's nothing to warn about.
 */
function formatDuplicateWarning(results: DiscoveryResult[]): string {
  const groups = findRunIdDuplicates(results);
  if (groups.length === 0) return '';

  const lines = groups.map((group) => {
    const runId = group[0].inventory?.runId ?? '';
    const shortId = runId.length > 12 ? `${runId.slice(0, 12)}…` : runId;
    const endpoints = group.map((r) => `${r.host}:${r.port}`).join(', ');
    return `  ${shortId}  ${endpoints}`;
  });
  const groupWord = groups.length === 1 ? 'group' : 'groups';

  return (
    `\n\n⚠ ${groups.length} ${groupWord} of results share the same Run ID — likely the ` +
    `same\n  database reachable through multiple endpoints (common with Redis\n` +
    `  Enterprise's proxy layer):\n${lines.join('\n')}`
  );
}

export function formatTable(results: DiscoveryResult[]): string {
  if (results.length === 0) return 'No Redis instances found.';
  const rows = results.map(toRow);
  const widths = Object.fromEntries(
    KEYS.map((k) => [k, Math.max(HEADERS[k].length, ...rows.map((r) => r[k].length))]),
  ) as Record<keyof Row, number>;
  const sep = '  ';
  const header = KEYS.map((k) => HEADERS[k].padEnd(widths[k])).join(sep);
  const divider = KEYS.map((k) => '─'.repeat(widths[k])).join(sep);
  const lines = rows.map((row) => KEYS.map((k) => row[k].padEnd(widths[k])).join(sep));
  return [header, divider, ...lines].join('\n') + formatDuplicateWarning(results);
}

export function formatJson(results: DiscoveryResult[]): string {
  return JSON.stringify(results, null, 2);
}
