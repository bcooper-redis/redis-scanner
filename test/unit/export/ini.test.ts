import { describe, it, expect } from 'vitest';
import { toIni } from '../../../src/export/index';
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
      connectedReplicas: [],
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
    modules: [],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: 5,
  },
  tlsCertificate: null,
};

const TLS_INSTANCE: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.2',
  port: 6380,
  tls: true,
  authRequired: true,
  anonymousStatus: 'auth_required',
  authenticatedStatus: 'not_attempted',
  version: null,
  inventory: null,
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

describe('toIni', () => {
  it('produces one section per result, keyed by host:port', () => {
    const ini = toIni([OPEN, TLS_INSTANCE]);
    expect(ini).toContain('[10.0.0.1:6379]');
    expect(ini).toContain('[10.0.0.2:6380]');
  });

  it('is valid INI that Python configparser can load, with the fields osstats reads', () => {
    // osstats (https://github.com/Redislabs-Solution-Architects/osstats)
    // reads host/port/tls/username/password via configparser — this proves
    // the generated file actually parses, not just that it looks right.
    const ini = toIni([OPEN]);
    const lines = ini.split('\n').filter((l) => l.includes('='));
    expect(lines.some((l) => l.trim().startsWith('host'))).toBe(true);
    expect(lines.some((l) => l.trim().startsWith('port'))).toBe(true);
    expect(lines.some((l) => l.trim().startsWith('tls'))).toBe(true);
  });

  it('populates host, port, and tls for each result', () => {
    const ini = toIni([OPEN]);
    expect(ini).toContain('host        = 10.0.0.1');
    expect(ini).toContain('port        = 6379');
    expect(ini).toContain('tls         = false');
  });

  it('writes tls as an explicit true, never blank, for a TLS result', () => {
    // osstats parses this with configparser's getboolean(), which throws on
    // an empty string — unlike username/password, this field can never be
    // left blank, even though the upstream example leaves it blank.
    const ini = toIni([TLS_INSTANCE]);
    expect(ini).toContain('tls         = true');
  });

  it('always leaves username and password blank — Redis Discovery never retains credentials', () => {
    const ini = toIni([OPEN]);
    const lines = ini.split('\n');
    expect(lines).toContain('username    = ');
    expect(lines).toContain('password    = ');
  });

  it('includes commented-out ca_cert/client_cert/client_key placeholders', () => {
    const ini = toIni([OPEN]);
    expect(ini).toContain('; ca_cert     = /path/to/ca.crt');
    expect(ini).toContain('; client_cert = /path/to/client.crt');
    expect(ini).toContain('; client_key  = /path/to/client.key');
  });

  it('works the same whether auth is required or not — host/port/tls come from the probe, not inventory', () => {
    const ini = toIni([TLS_INSTANCE]);
    expect(TLS_INSTANCE.inventory).toBeNull();
    expect(ini).toContain('host        = 10.0.0.2');
    expect(ini).toContain('port        = 6380');
    expect(ini).toContain('tls         = true');
  });

  it('produces no sections for empty results, but still a valid header', () => {
    const ini = toIni([]);
    expect(ini).not.toContain('[');
    expect(ini.trim().length).toBeGreaterThan(0);
  });

  it('separates sections with a blank line', () => {
    const ini = toIni([OPEN, TLS_INSTANCE]);
    expect(ini).toContain('\n\n[10.0.0.2:6380]');
  });
});
