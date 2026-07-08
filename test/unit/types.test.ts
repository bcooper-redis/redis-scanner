import { describe, it, expect } from 'vitest';
import { productDisplay, findRunIdDuplicates } from '../../src/types/index';
import type { DiscoveryResult, ScanConfig, AuthCredentials } from '../../src/types/index';

function makeResult(host: string, port: number, runId: string | null): DiscoveryResult {
  return {
    host,
    port,
    tls: false,
    product: 'redis',
    version: '8.2.2',
    authRequired: false,
    anonymousStatus: 'open',
    authenticatedStatus: 'not_attempted',
    latency: 1,
    inventory: {
      redisVersion: '8.2.2',
      mode: 'standalone',
      os: 'Linux',
      uptimeSeconds: 100,
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
      runId,
      connectedClients: null,
    },
    tlsCertificate: null,
  };
}

describe('DiscoveryResult', () => {
  it('accepts a valid unauthenticated result', () => {
    const result: DiscoveryResult = {
      host: '127.0.0.1',
      port: 6379,
      tls: false,
      product: 'redis',
      version: '7.2.0',
      authRequired: false,
      anonymousStatus: 'open',
      authenticatedStatus: 'not_attempted',
      latency: 2,
      inventory: null,
      tlsCertificate: null,
    };
    expect(result.host).toBe('127.0.0.1');
    expect(result.inventory).toBeNull();
  });

  it('accepts a result with inventory', () => {
    const result: DiscoveryResult = {
      host: '10.0.0.1',
      port: 6380,
      tls: true,
      product: 'valkey',
      version: '8.0.0',
      authRequired: true,
      anonymousStatus: 'auth_required',
      authenticatedStatus: 'authenticated',
      latency: 5,
      inventory: {
        redisVersion: '8.0.0',
        mode: 'standalone',
        os: 'Linux 5.15.0 x86_64',
        uptimeSeconds: 86400,
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
        runId: null,
        connectedClients: null,
      },
      tlsCertificate: {
        subject: 'valkey.example.com',
        issuer: "Let's Encrypt",
        validFrom: 'Jan 1 00:00:00 2026 GMT',
        validTo: 'Apr 1 00:00:00 2026 GMT',
        selfSigned: false,
        trusted: true,
        fingerprint256: 'AA:BB:CC',
      },
    };
    expect(result.inventory?.mode).toBe('standalone');
  });
});

describe('ScanConfig', () => {
  it('accepts a valid config', () => {
    const config: ScanConfig = {
      cidrs: ['192.168.1.0/24'],
      ports: [6379, 6380],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 100,
    };
    expect(config.ports).toHaveLength(2);
  });
});

describe('productDisplay', () => {
  it('labels OSS Redis as "redis OSS"', () => {
    expect(productDisplay('redis')).toBe('redis OSS');
  });

  it('leaves valkey, keydb, enterprise, and unknown unchanged', () => {
    expect(productDisplay('valkey')).toBe('valkey');
    expect(productDisplay('keydb')).toBe('keydb');
    expect(productDisplay('enterprise')).toBe('enterprise');
    expect(productDisplay('unknown')).toBe('unknown');
  });
});

describe('findRunIdDuplicates', () => {
  it('returns nothing when every run_id is unique', () => {
    const results = [makeResult('10.0.0.1', 6379, 'aaa'), makeResult('10.0.0.2', 6379, 'bbb')];
    expect(findRunIdDuplicates(results)).toEqual([]);
  });

  it('groups results that share the same run_id', () => {
    const a = makeResult('10.0.0.1', 12000, 'shared-id');
    const b = makeResult('10.0.0.2', 12000, 'shared-id');
    const c = makeResult('10.0.0.3', 12000, 'shared-id');
    const other = makeResult('10.0.0.9', 6379, 'unique-id');

    const groups = findRunIdDuplicates([a, other, b, c]);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toEqual([a, b, c]);
  });

  it('never groups results with a missing run_id together', () => {
    const noRunId1 = makeResult('10.0.0.1', 6379, null);
    const noRunId2 = makeResult('10.0.0.2', 6379, null);
    expect(findRunIdDuplicates([noRunId1, noRunId2])).toEqual([]);
  });

  it('ignores results with no inventory at all', () => {
    const noInventory: DiscoveryResult = { ...makeResult('10.0.0.1', 6379, 'x'), inventory: null };
    const withInventory = makeResult('10.0.0.2', 6379, 'x');
    // Only one result actually carries the run_id, so there's no real duplicate.
    expect(findRunIdDuplicates([noInventory, withInventory])).toEqual([]);
  });

  it('can return multiple independent duplicate groups', () => {
    const a1 = makeResult('10.0.0.1', 12000, 'group-a');
    const a2 = makeResult('10.0.0.2', 12000, 'group-a');
    const b1 = makeResult('10.0.0.3', 13000, 'group-b');
    const b2 = makeResult('10.0.0.4', 13000, 'group-b');

    const groups = findRunIdDuplicates([a1, b1, a2, b2]);
    expect(groups).toHaveLength(2);
    expect(groups).toContainEqual([a1, a2]);
    expect(groups).toContainEqual([b1, b2]);
  });
});

describe('AuthCredentials', () => {
  it('accepts password-only credentials', () => {
    const creds: AuthCredentials = { password: 'secret' };
    expect(creds.username).toBeUndefined();
  });

  it('accepts ACL credentials', () => {
    const creds: AuthCredentials = { username: 'alice', password: 'secret' };
    expect(creds.username).toBe('alice');
  });
});
