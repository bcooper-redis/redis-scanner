import { describe, it, expect } from 'vitest';
import { formatTable, formatJson } from '../../../src/cli/format';
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
  latency: 3,
  inventory: {
    redisVersion: '8.0.0',
    mode: 'standalone',
    os: 'Linux',
    uptimeSeconds: 3600,
    role: 'master',
    replication: {
      connectedReplicas: [],
      masterHost: null,
      masterPort: null,
      masterLinkStatus: null,
    },
    memory: {
      usedMemoryBytes: null,
      maxMemoryBytes: null,
      maxMemoryPolicy: null,
      totalSystemMemoryBytes: null,
      usedMemoryPeakBytes: null,
    },
    keyspace: [],
    modules: [],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: null,
  },
  tlsCertificate: null,
};

const AUTH_REQUIRED: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.2',
  port: 6380,
  authRequired: true,
  anonymousStatus: 'auth_required',
  authenticatedStatus: 'not_attempted',
  version: null,
  inventory: null,
};

describe('formatTable', () => {
  it('returns placeholder for empty array', () => {
    expect(formatTable([])).toBe('No Redis instances found.');
  });

  it('includes all column headers', () => {
    const out = formatTable([OPEN]);
    for (const hdr of ['HOST', 'PORT', 'TLS', 'PRODUCT', 'VERSION', 'AUTH', 'ROLE', 'LATENCY']) {
      expect(out).toContain(hdr);
    }
  });

  it('includes a divider row', () => {
    expect(formatTable([OPEN])).toContain('─');
  });

  it('shows host, port, product, version for open Redis', () => {
    const out = formatTable([OPEN]);
    expect(out).toContain('10.0.0.1');
    expect(out).toContain('6379');
    expect(out).toContain('redis OSS');
    expect(out).toContain('8.0.0');
    expect(out).toContain('open');
    expect(out).toContain('master');
    expect(out).toContain('3ms');
  });

  it("labels OSS Redis as 'redis OSS' but leaves other products alone", () => {
    expect(formatTable([{ ...OPEN, product: 'redis' }])).toContain('redis OSS');
    expect(formatTable([{ ...OPEN, product: 'valkey' }])).toContain('valkey');
    expect(formatTable([{ ...OPEN, product: 'enterprise' }])).toContain('enterprise');
    expect(formatTable([{ ...OPEN, product: 'enterprise' }])).not.toContain('enterprise OSS');
  });

  it("shows 'no' TLS for plain connection", () => {
    expect(formatTable([OPEN])).toContain('no');
  });

  it("shows 'yes' TLS for TLS connection", () => {
    expect(formatTable([{ ...OPEN, tls: true }])).toContain('yes');
  });

  it("shows '—' version when null", () => {
    expect(formatTable([AUTH_REQUIRED])).toContain('—');
  });

  it("shows 'required' auth for auth_required without credentials", () => {
    expect(formatTable([AUTH_REQUIRED])).toContain('required');
  });

  it("shows 'authed' when credentials succeeded", () => {
    const r: DiscoveryResult = {
      ...OPEN,
      authenticatedStatus: 'authenticated',
    };
    expect(formatTable([r])).toContain('authed');
  });

  it("shows 'wrong pw' when credentials were rejected", () => {
    const r: DiscoveryResult = {
      ...AUTH_REQUIRED,
      authenticatedStatus: 'auth_failed',
    };
    expect(formatTable([r])).toContain('wrong pw');
  });

  it("shows 'error' for non-Redis open port", () => {
    const r: DiscoveryResult = {
      ...OPEN,
      anonymousStatus: 'error',
    };
    expect(formatTable([r])).toContain('error');
  });

  it('renders multiple rows', () => {
    const out = formatTable([OPEN, AUTH_REQUIRED]);
    expect(out).toContain('10.0.0.1');
    expect(out).toContain('10.0.0.2');
  });

  it('aligns columns — all rows have the same character length', () => {
    const out = formatTable([OPEN, AUTH_REQUIRED]);
    const lines = out.split('\n').filter((l) => l.trim());
    const lengths = lines.map((l) => l.length);
    expect(new Set(lengths).size).toBe(1);
  });
});

describe('formatTable — duplicate run_id warning', () => {
  it('adds no warning when no results share a run_id', () => {
    expect(formatTable([OPEN, AUTH_REQUIRED])).not.toContain('⚠');
  });

  it('warns when two results share the same run_id, listing both endpoints', () => {
    const other: DiscoveryResult = { ...OPEN, host: '10.0.0.9', port: 12000 };
    const out = formatTable([OPEN, other]);
    expect(out).toContain('⚠');
    expect(out).toContain('Run ID');
    expect(out).toContain('10.0.0.1:6379');
    expect(out).toContain('10.0.0.9:12000');
  });

  it('never warns when the shared field is a missing run_id', () => {
    const noRunId1: DiscoveryResult = {
      ...AUTH_REQUIRED,
      host: '10.0.0.5',
      inventory: { ...OPEN.inventory!, runId: null },
      authRequired: false,
      anonymousStatus: 'open',
    };
    const noRunId2: DiscoveryResult = { ...noRunId1, host: '10.0.0.6' };
    expect(formatTable([noRunId1, noRunId2])).not.toContain('⚠');
  });

  it('reports one warning line per duplicate group', () => {
    const groupA2: DiscoveryResult = { ...OPEN, host: '10.0.0.10' };
    const groupB1: DiscoveryResult = {
      ...OPEN,
      host: '10.0.0.20',
      inventory: { ...OPEN.inventory!, runId: 'different-run-id-00000000000000000000000' },
    };
    const groupB2: DiscoveryResult = { ...groupB1, host: '10.0.0.21' };

    const out = formatTable([OPEN, groupA2, groupB1, groupB2]);
    expect(out).toContain('2 groups');
    expect(out).toContain('10.0.0.10');
    expect(out).toContain('10.0.0.20');
    expect(out).toContain('10.0.0.21');
  });
});

describe('formatJson', () => {
  it('returns valid JSON array for one result', () => {
    const parsed = JSON.parse(formatJson([OPEN]));
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
  });

  it('includes all DiscoveryResult fields', () => {
    const [r] = JSON.parse(formatJson([OPEN]));
    expect(r.host).toBe('10.0.0.1');
    expect(r.port).toBe(6379);
    expect(r.product).toBe('redis');
    expect(r.version).toBe('8.0.0');
    expect(r.inventory.role).toBe('master');
  });

  it('returns valid JSON for empty array', () => {
    const parsed = JSON.parse(formatJson([]));
    expect(parsed).toEqual([]);
  });
});
