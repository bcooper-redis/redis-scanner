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
    memory: { usedMemoryBytes: 1048576, maxMemoryBytes: null, maxMemoryPolicy: 'noeviction' },
    keyspace: [{ db: 0, keys: 5, expires: 1, avgTtlMs: 0 }],
    modules: [{ name: 'search', version: 20811, path: '/usr/lib/redis/modules/redisearch.so' }],
    clusterInfo: null,
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
