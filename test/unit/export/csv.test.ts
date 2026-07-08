import { describe, it, expect } from 'vitest';
import { toCsv } from '../../../src/export/index';
import { parseCsvLine } from '../../../src/scanner/credentialCsv';
import type { DiscoveryResult } from '../../../src/types';

// Row/header-index assertions below use parseCsvLine (not a naive
// .split(',')) because several columns (Replica/Keyspace/Module Details) are
// quoted CSV fields containing embedded commas — a naive split would count
// them as extra columns and throw off every index after them.
function cellsOf(csv: string, rowIndex: number): string[] {
  return parseCsvLine(csv.split('\r\n')[rowIndex]);
}

const OPEN: DiscoveryResult = {
  host: '10.0.0.1',
  port: 6379,
  tls: false,
  product: 'redis',
  version: '8.0.0',
  authRequired: false,
  anonymousStatus: 'open',
  authenticatedStatus: 'not_attempted',
  latency: 5,
  inventory: {
    redisVersion: '8.0.0',
    mode: 'standalone',
    os: 'Linux x86_64',
    uptimeSeconds: 3600,
    role: 'master',
    replication: {
      connectedReplicas: [{ ip: '10.0.0.2', port: 6379, state: 'online', offset: 14, lag: 0 }],
      masterHost: null,
      masterPort: null,
      masterLinkStatus: null,
    },
    memory: {
      usedMemoryBytes: 1048576,
      maxMemoryBytes: 2097152,
      maxMemoryPolicy: 'noeviction',
      totalSystemMemoryBytes: 17179869184,
      usedMemoryPeakBytes: 1572864,
    },
    keyspace: [{ db: 0, keys: 5, expires: 1, avgTtlMs: 0 }],
    modules: [{ name: 'search', version: 20811, path: '/usr/lib/redis/modules/redisearch.so' }],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: 7,
  },
  tlsCertificate: null,
};

const CLUSTER_NODE: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.5',
  inventory: {
    ...OPEN.inventory!,
    mode: 'cluster',
    clusterInfo: { enabled: true, state: 'ok', slotsAssigned: 16384, knownNodes: 6, size: 3 },
    runId: 'c5b4a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8',
  },
};

const REPLICA: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.3',
  inventory: {
    ...OPEN.inventory!,
    role: 'replica',
    replication: {
      connectedReplicas: [],
      masterHost: '10.0.0.1',
      masterPort: 6379,
      masterLinkStatus: 'up',
    },
    runId: 'b4a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d',
  },
};

const AUTH_REQUIRED: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.2',
  authRequired: true,
  anonymousStatus: 'auth_required',
  authenticatedStatus: 'not_attempted',
  version: null,
  inventory: null,
};

// Auth-required AND over TLS — the whole point of tlsCertificate living at
// the top level: the cert is readable even though inventory is null here.
const AUTH_REQUIRED_TLS: DiscoveryResult = {
  ...AUTH_REQUIRED,
  host: '10.0.0.4',
  tls: true,
  tlsCertificate: {
    subject: 'db.example.com',
    issuer: 'db.example.com',
    validFrom: 'Jan 1 00:00:00 2026 GMT',
    validTo: 'Jan 1 00:00:00 2027 GMT',
    selfSigned: true,
    trusted: false,
    fingerprint256: 'AA:BB:CC',
  },
};

describe('toCsv', () => {
  it('includes header row as first line', () => {
    const lines = toCsv([OPEN]).split('\r\n');
    expect(lines[0]).toContain('Host');
    expect(lines[0]).toContain('Port');
    expect(lines[0]).toContain('Product');
    expect(lines[0]).toContain('Version');
    expect(lines[0]).toContain('Auth Required');
    expect(lines[0]).toContain('Connected Clients');
    expect(lines[0]).toContain('Used Memory (bytes)');
    expect(lines[0]).toContain('Max Memory (bytes)');
    expect(lines[0]).toContain('Used Memory Peak (bytes)');
    expect(lines[0]).toContain('Total System Memory (bytes)');
    expect(lines[0]).toContain('Max Memory Policy');
    expect(lines[0]).toContain('Connected Replicas');
    expect(lines[0]).toContain('Replica Details');
    expect(lines[0]).toContain('Total Keys');
    expect(lines[0]).toContain('Keyspace Detail');
    expect(lines[0]).toContain('Modules');
    expect(lines[0]).toContain('Module Details');
    expect(lines[0]).toContain('Cluster State');
    expect(lines[0]).toContain('Cluster Enabled');
    expect(lines[0]).toContain('Cluster Slots Assigned');
    expect(lines[0]).toContain('Cluster Known Nodes');
    expect(lines[0]).toContain('Cluster Size');
    expect(lines[0]).toContain('Master Host');
    expect(lines[0]).toContain('Master Port');
    expect(lines[0]).toContain('Master Link Status');
    expect(lines[0]).toContain('Run ID');
    expect(lines[0]).toContain('Cert Subject');
    expect(lines[0]).toContain('Cert Issuer');
    expect(lines[0]).toContain('Cert Valid From');
    expect(lines[0]).toContain('Cert Valid To');
    expect(lines[0]).toContain('Cert Self-Signed');
    expect(lines[0]).toContain('Cert Trusted');
    expect(lines[0]).toContain('Cert Fingerprint (SHA-256)');
  });

  it('includes a data row for each result', () => {
    const lines = toCsv([OPEN, AUTH_REQUIRED]).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(3); // header + 2 rows
  });

  it('populates host, port, product, version for open result', () => {
    const csv = toCsv([OPEN]);
    expect(csv).toContain('10.0.0.1');
    expect(csv).toContain('6379');
    expect(csv).toContain('redis OSS');
    expect(csv).toContain('8.0.0');
    expect(csv).toContain('open');
    expect(csv).toContain('master');
    expect(csv).toContain('3600');
  });

  it("labels OSS Redis as 'redis OSS' but leaves other products alone", () => {
    expect(toCsv([{ ...OPEN, product: 'redis' }])).toContain('redis OSS');
    expect(toCsv([{ ...OPEN, product: 'valkey' }])).toContain('valkey');
    expect(toCsv([{ ...OPEN, product: 'enterprise' }])).toContain('enterprise');
    expect(toCsv([{ ...OPEN, product: 'enterprise' }])).not.toContain('enterprise OSS');
  });

  it('leaves inventory fields empty when inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED]);
    const dataRow = csv.split('\r\n')[1];
    // version, role, mode, os, uptime should be empty
    expect(dataRow).toContain(',,');
  });

  it('populates memory, replicas, keys, modules, and cluster state', () => {
    const csv = toCsv([OPEN]);
    expect(csv).toContain('1048576');
    expect(csv).toContain('2097152');
    expect(csv).toContain('1572864');
    expect(csv).toContain('17179869184');
    expect(csv).toContain('noeviction');
    expect(csv).toContain('search');
  });

  it('leaves the new inventory-derived columns empty when inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED]);
    expect(csv).not.toContain('1048576');
    expect(csv).not.toContain('2097152');
    expect(csv).not.toContain('1572864');
    expect(csv).not.toContain('17179869184');
    expect(csv).not.toContain('noeviction');
    expect(csv).not.toContain('search');

    const headerCells = cellsOf(csv, 0);
    const dataCells = cellsOf(csv, 1);
    for (const col of [
      'Replica Details',
      'Keyspace Detail',
      'Module Details',
      'Connected Clients',
    ]) {
      expect(dataCells[headerCells.indexOf(col)]).toBe('');
    }
  });

  it('populates Auth Required for both true and false', () => {
    const openCsv = toCsv([OPEN]);
    expect(cellsOf(openCsv, 1)[cellsOf(openCsv, 0).indexOf('Auth Required')]).toBe('false');

    const requiredCsv = toCsv([AUTH_REQUIRED]);
    expect(cellsOf(requiredCsv, 1)[cellsOf(requiredCsv, 0).indexOf('Auth Required')]).toBe('true');
  });

  it('populates Connected Clients', () => {
    expect(toCsv([OPEN])).toContain('7');
  });

  it('populates Replica Details, Keyspace Detail, and Module Details with full per-entry fidelity', () => {
    const csv = toCsv([OPEN]);
    expect(csv).toContain('10.0.0.2:6379 (state=online, offset=14, lag=0)');
    expect(csv).toContain('db0: keys=5, expires=1, avgTtlMs=0');
    expect(csv).toContain('search (v20811, /usr/lib/redis/modules/redisearch.so)');
  });

  it('populates cluster detail columns when the node reports cluster mode', () => {
    const csv = toCsv([CLUSTER_NODE]);
    const headerCells = cellsOf(csv, 0);
    const cells = cellsOf(csv, 1);
    expect(cells[headerCells.indexOf('Cluster State')]).toBe('ok');
    expect(cells[headerCells.indexOf('Cluster Enabled')]).toBe('true');
    expect(cells[headerCells.indexOf('Cluster Slots Assigned')]).toBe('16384');
    expect(cells[headerCells.indexOf('Cluster Known Nodes')]).toBe('6');
    expect(cells[headerCells.indexOf('Cluster Size')]).toBe('3');
  });

  it('leaves cluster detail columns empty for a standalone node', () => {
    const csv = toCsv([OPEN]);
    const headerCells = cellsOf(csv, 0);
    const cells = cellsOf(csv, 1);
    for (const col of [
      'Cluster Enabled',
      'Cluster Slots Assigned',
      'Cluster Known Nodes',
      'Cluster Size',
    ]) {
      expect(cells[headerCells.indexOf(col)]).toBe('');
    }
  });

  it('populates master host/port/link status for a replica', () => {
    const csv = toCsv([REPLICA]);
    expect(csv).toContain('10.0.0.1'); // master host
    expect(csv).toContain('6379'); // master port
    expect(csv).toContain('up'); // master link status
    expect(csv).toContain('replica');
  });

  it('leaves master host/port/link status empty for a master (no upstream)', () => {
    const csv = toCsv([OPEN]);
    const headerCells = cellsOf(csv, 0);
    const cells = cellsOf(csv, 1);
    expect(cells[headerCells.indexOf('Master Host')]).toBe('');
    expect(cells[headerCells.indexOf('Master Link Status')]).toBe('');
  });

  it('populates the Run ID column', () => {
    expect(toCsv([OPEN])).toContain('a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1');
  });

  it('leaves Run ID empty when inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED]);
    expect(csv).not.toContain('a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1');
  });

  it('populates certificate columns even when auth is required and inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED_TLS]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('db.example.com');
    expect(dataRow).toContain('true'); // self-signed
    expect(dataRow).toContain('false'); // not trusted
    // Confirms this isn't a fluke of the (null) inventory columns being blank —
    // the row genuinely has both empty inventory cells AND populated cert cells.
    expect(AUTH_REQUIRED_TLS.inventory).toBeNull();
  });

  it('leaves certificate columns empty for a plaintext connection', () => {
    const csv = toCsv([OPEN]);
    const headerCells = cellsOf(csv, 0);
    const cells = cellsOf(csv, 1);
    expect(cells[headerCells.indexOf('Cert Subject')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Self-Signed')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Trusted')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Valid From')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Fingerprint (SHA-256)')]).toBe('');
  });

  it('populates Cert Valid From and Cert Fingerprint', () => {
    const csv = toCsv([AUTH_REQUIRED_TLS]);
    const headerCells = cellsOf(csv, 0);
    const cells = cellsOf(csv, 1);
    expect(cells[headerCells.indexOf('Cert Valid From')]).toBe('Jan 1 00:00:00 2026 GMT');
    expect(cells[headerCells.indexOf('Cert Fingerprint (SHA-256)')]).toBe('AA:BB:CC');
  });

  it('quotes values containing commas', () => {
    const tricky: DiscoveryResult = {
      ...OPEN,
      inventory: { ...OPEN.inventory!, os: 'Linux, x86_64' },
    };
    expect(toCsv([tricky])).toContain('"Linux, x86_64"');
  });

  it('escapes double quotes inside quoted values', () => {
    const tricky: DiscoveryResult = {
      ...OPEN,
      inventory: { ...OPEN.inventory!, os: 'say "hello"' },
    };
    expect(toCsv([tricky])).toContain('"say ""hello"""');
  });

  it('returns only the header row for empty results', () => {
    const lines = toCsv([]).split('\r\n').filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Host');
  });

  it('uses CRLF line endings', () => {
    expect(toCsv([OPEN])).toContain('\r\n');
  });
});
