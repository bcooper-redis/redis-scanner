import { describe, it, expect } from 'vitest';
import { productDisplay } from '../../src/types/index';
import type { DiscoveryResult, ScanConfig, AuthCredentials } from '../../src/types/index';

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
        memory: { usedMemoryBytes: null, maxMemoryBytes: null, maxMemoryPolicy: null },
        keyspace: [],
        modules: [],
        clusterInfo: null,
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
