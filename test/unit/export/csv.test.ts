import { describe, it, expect } from 'vitest';
import { toCsv } from '../../../src/export/index';
import type { DiscoveryResult } from '../../../src/types';

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
      maxMemoryBytes: null,
      maxMemoryPolicy: 'noeviction',
      totalSystemMemoryBytes: null,
      usedMemoryPeakBytes: null,
    },
    keyspace: [{ db: 0, keys: 5, expires: 1, avgTtlMs: 0 }],
    modules: [{ name: 'search', version: 20811, path: '/usr/lib/redis/modules/redisearch.so' }],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: null,
  },
  tlsCertificate: null,
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
    expect(lines[0]).toContain('Used Memory (bytes)');
    expect(lines[0]).toContain('Max Memory Policy');
    expect(lines[0]).toContain('Connected Replicas');
    expect(lines[0]).toContain('Total Keys');
    expect(lines[0]).toContain('Modules');
    expect(lines[0]).toContain('Cluster State');
    expect(lines[0]).toContain('Master Host');
    expect(lines[0]).toContain('Master Port');
    expect(lines[0]).toContain('Master Link Status');
    expect(lines[0]).toContain('Run ID');
    expect(lines[0]).toContain('Cert Subject');
    expect(lines[0]).toContain('Cert Issuer');
    expect(lines[0]).toContain('Cert Valid To');
    expect(lines[0]).toContain('Cert Self-Signed');
    expect(lines[0]).toContain('Cert Trusted');
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
    expect(csv).toContain('noeviction');
    expect(csv).toContain('search');
  });

  it('leaves the new inventory-derived columns empty when inventory is null', () => {
    const csv = toCsv([AUTH_REQUIRED]);
    expect(csv).not.toContain('1048576');
    expect(csv).not.toContain('noeviction');
    expect(csv).not.toContain('search');
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
    const dataRow = csv.split('\r\n')[1];
    const cells = dataRow.split(',');
    const headerCells = toCsv([OPEN]).split('\r\n')[0].split(',');
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
    const dataRow = csv.split('\r\n')[1];
    const headerCells = csv.split('\r\n')[0].split(',');
    const cells = dataRow.split(',');
    expect(cells[headerCells.indexOf('Cert Subject')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Self-Signed')]).toBe('');
    expect(cells[headerCells.indexOf('Cert Trusted')]).toBe('');
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
