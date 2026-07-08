import { productDisplay } from '../types';
import type { DiscoveryResult } from '../types';
import { buildXlsxWorkbook } from './xlsx';
import type { CellValue } from './xlsx';

// Every field DiscoveryResult exposes (including nested inventory/cert
// fields) gets a column here, even ones the Results table/CSV summary
// columns don't show — this is meant to be a complete dump, not a curated
// view. Array fields (replicas, keyspace, modules) get both a summary column
// (matching what the table shows) and a "Details" column serializing every
// entry, since CSV can't give a variable-length array its own columns.
// inventory.redisVersion is deliberately not a separate column — it's always
// identical to the top-level Version column (assembleResult sets both from
// the same probe.version), so a second copy would just be a confusing dupe.
const CSV_HEADERS = [
  'Host',
  'Port',
  'TLS',
  'Product',
  'Version',
  'Auth Required',
  'Auth Status',
  'Authenticated Status',
  'Role',
  'Mode',
  'OS',
  'Uptime (s)',
  'Connected Clients',
  'Latency (ms)',
  'Used Memory (bytes)',
  'Max Memory (bytes)',
  'Used Memory Peak (bytes)',
  'Total System Memory (bytes)',
  'Max Memory Policy',
  'Connected Replicas',
  'Replica Details',
  'Master Host',
  'Master Port',
  'Master Link Status',
  'Total Keys',
  'Keyspace Detail',
  'Modules',
  'Module Details',
  'Cluster State',
  'Cluster Enabled',
  'Cluster Slots Assigned',
  'Cluster Known Nodes',
  'Cluster Size',
  'Run ID',
  'Cert Subject',
  'Cert Issuer',
  'Cert Valid From',
  'Cert Valid To',
  'Cert Self-Signed',
  'Cert Trusted',
  'Cert Fingerprint (SHA-256)',
];

function escape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

function totalKeys(r: DiscoveryResult): string {
  if (!r.inventory) return '';
  return String(r.inventory.keyspace.reduce((sum, db) => sum + db.keys, 0));
}

function replicaDetails(r: DiscoveryResult): string {
  if (!r.inventory) return '';
  return r.inventory.replication.connectedReplicas
    .map(
      (rep) => `${rep.ip}:${rep.port} (state=${rep.state}, offset=${rep.offset}, lag=${rep.lag})`,
    )
    .join('; ');
}

function keyspaceDetail(r: DiscoveryResult): string {
  if (!r.inventory) return '';
  return r.inventory.keyspace
    .map((db) => `db${db.db}: keys=${db.keys}, expires=${db.expires}, avgTtlMs=${db.avgTtlMs}`)
    .join('; ');
}

function moduleDetails(r: DiscoveryResult): string {
  if (!r.inventory) return '';
  return r.inventory.modules.map((m) => `${m.name} (v${m.version}, ${m.path})`).join('; ');
}

function toRow(r: DiscoveryResult): string {
  const cluster = r.inventory?.clusterInfo ?? null;
  return [
    r.host,
    String(r.port),
    String(r.tls),
    productDisplay(r.product),
    r.version ?? '',
    String(r.authRequired),
    r.anonymousStatus,
    r.authenticatedStatus,
    r.inventory?.role ?? '',
    r.inventory?.mode ?? '',
    r.inventory?.os ?? '',
    r.inventory != null ? String(r.inventory.uptimeSeconds) : '',
    r.inventory?.connectedClients != null ? String(r.inventory.connectedClients) : '',
    String(r.latency),
    r.inventory?.memory.usedMemoryBytes != null ? String(r.inventory.memory.usedMemoryBytes) : '',
    r.inventory?.memory.maxMemoryBytes != null ? String(r.inventory.memory.maxMemoryBytes) : '',
    r.inventory?.memory.usedMemoryPeakBytes != null
      ? String(r.inventory.memory.usedMemoryPeakBytes)
      : '',
    r.inventory?.memory.totalSystemMemoryBytes != null
      ? String(r.inventory.memory.totalSystemMemoryBytes)
      : '',
    r.inventory?.memory.maxMemoryPolicy ?? '',
    r.inventory ? String(r.inventory.replication.connectedReplicas.length) : '',
    replicaDetails(r),
    r.inventory?.replication.masterHost ?? '',
    r.inventory?.replication.masterPort != null ? String(r.inventory.replication.masterPort) : '',
    r.inventory?.replication.masterLinkStatus ?? '',
    totalKeys(r),
    keyspaceDetail(r),
    r.inventory?.modules.map((m) => m.name).join(', ') ?? '',
    moduleDetails(r),
    cluster?.state ?? '',
    cluster ? String(cluster.enabled) : '',
    cluster != null ? String(cluster.slotsAssigned) : '',
    cluster != null ? String(cluster.knownNodes) : '',
    cluster != null ? String(cluster.size) : '',
    r.inventory?.runId ?? '',
    r.tlsCertificate?.subject ?? '',
    r.tlsCertificate?.issuer ?? '',
    r.tlsCertificate?.validFrom ?? '',
    r.tlsCertificate?.validTo ?? '',
    r.tlsCertificate ? String(r.tlsCertificate.selfSigned) : '',
    r.tlsCertificate ? String(r.tlsCertificate.trusted) : '',
    r.tlsCertificate?.fingerprint256 ?? '',
  ]
    .map(escape)
    .join(',');
}

export function toCsv(results: DiscoveryResult[]): string {
  const rows = [CSV_HEADERS.join(','), ...results.map(toRow)];
  return rows.join('\r\n') + '\r\n';
}

// Matches the field layout/comments of osstats' config.ini.example
// (https://github.com/Redislabs-Solution-Architects/osstats), so a scan's
// results can be handed straight to that tool. Every key, active or
// commented-out, is padded to the same 12-char column osstats' example uses.
const INI_KEY_WIDTH = 12;

function iniField(key: string, value: string, commented = false): string {
  const prefix = commented ? '; ' : '';
  return `${prefix}${key.padEnd(INI_KEY_WIDTH)}= ${value}`;
}

function toIniSection(r: DiscoveryResult): string {
  return [
    `[${r.host}:${r.port}]`,
    iniField('host', r.host),
    iniField('port', String(r.port)),
    // osstats reads this with configparser's getboolean(), which throws on
    // an empty string — unlike username/password below, this can't be left
    // blank, so it's always written explicitly.
    iniField('tls', r.tls ? 'true' : 'false'),
    '; Username in case ACL access in enabled',
    iniField('username', ''),
    '; Password that applies either in db or user (ACL)',
    iniField('password', ''),
    iniField('ca_cert', '/path/to/ca.crt', true),
    iniField('client_cert', '/path/to/client.crt', true),
    iniField('client_key', '/path/to/client.key', true),
  ].join('\n');
}

/**
 * Renders scan results as an osstats-compatible config.ini: one section per
 * discovered host:port, pre-filled with host/port/tls. Redis Discovery never
 * holds credentials past the request that used them, so username/password
 * are always left blank for the operator to fill in before running osstats.
 */
export function toIni(results: DiscoveryResult[]): string {
  const header =
    '; Generated by Redis Discovery from scan results.\n' +
    '; Fill in username/password (and ca_cert/client_cert/client_key for mTLS)\n' +
    '; before running osstats against these targets.\n';
  return header + '\n' + results.map(toIniSection).join('\n\n') + '\n';
}

// The exact non-throughput column set osstats (https://github.com/Redislabs-
// Solution-Architects/osstats) writes to its "ClusterData" sheet, in its own
// column order. osstats' remaining ~20 columns (Throughput (Ops), GetTypeCmds,
// SetTypeCmds, HashBasedCmds, ...) are throughput deltas — it snapshots INFO
// COMMANDSTATS, waits several minutes, snapshots again, and subtracts. Redis
// Scanner does one point-in-time probe with no held-open connection or wait,
// so it has no data for those columns and — deliberately — doesn't fabricate
// zeros or blanks for them; they're omitted from this sheet entirely.
const OSSTATS_HEADERS = [
  'Source',
  'ClusterId',
  'NodeId',
  'NodeRole',
  'RedisVersion',
  'OS',
  'TotalSystemMemory',
  'BytesUsedForCache',
  'CurrConnections',
  'ClusterEnabled',
  'ConnectedSlaves',
  'MemoryUsed (Gb)',
  'CurrItems',
  'Namespaces',
];

function gb(bytes: number | null): number | null {
  return bytes != null ? Math.round((bytes / 1024 ** 3) * 1000) / 1000 : null;
}

function toOsstatsRow(r: DiscoveryResult): CellValue[] {
  const inv = r.inventory;
  const role = inv?.role === 'master' ? 'Master' : inv?.role === 'replica' ? 'Replica' : null;
  const namespaces = inv?.keyspace.map((db) => `db${db.db}:${db.keys}`).join(', ') ?? null;
  const currItems = inv ? inv.keyspace.reduce((sum, db) => sum + db.keys, 0) : null;

  return [
    productDisplay(r.product),
    null, // ClusterId — osstats groups nodes under a config-file section name; Scanner scans each host:port independently, with no such grouping to report
    r.host,
    role,
    r.version,
    inv?.os ?? null,
    gb(inv?.memory.totalSystemMemoryBytes ?? null),
    inv?.memory.usedMemoryPeakBytes ?? null,
    inv?.connectedClients ?? null,
    inv ? (inv.mode === 'cluster' ? 1 : 0) : null,
    inv ? inv.replication.connectedReplicas.length : null,
    gb(inv?.memory.usedMemoryPeakBytes ?? null),
    currItems,
    namespaces,
  ];
}

/**
 * Renders scan results as an .xlsx shaped like osstats' own output — same
 * sheet name and column layout, populated only with what Redis Discovery's
 * single-probe model actually knows. See OSSTATS_HEADERS for why the
 * throughput columns aren't included.
 */
export function toOsstatsXlsx(results: DiscoveryResult[]): Buffer {
  return buildXlsxWorkbook('ClusterData', OSSTATS_HEADERS, results.map(toOsstatsRow));
}
