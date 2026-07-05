import { productDisplay } from '../types';
import type { DiscoveryResult } from '../types';

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
    latency: `${r.latency}ms`,
  };
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
  return [header, divider, ...lines].join('\n');
}

export function formatJson(results: DiscoveryResult[]): string {
  return JSON.stringify(results, null, 2);
}
