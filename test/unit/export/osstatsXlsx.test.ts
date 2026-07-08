import { describe, it, expect } from 'vitest';
import { toOsstatsXlsx } from '../../../src/export/index';
import type { DiscoveryResult } from '../../../src/types';
import { extractStoredEntry } from './zipTestUtil';

function sheetXml(xlsx: Buffer): string {
  return extractStoredEntry(xlsx, 'xl/worksheets/sheet1.xml')!.toString('utf8');
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
      maxMemoryBytes: null,
      maxMemoryPolicy: 'noeviction',
      totalSystemMemoryBytes: 16 * 1024 ** 3,
      usedMemoryPeakBytes: 2 * 1024 ** 3,
    },
    keyspace: [
      { db: 0, keys: 5, expires: 1, avgTtlMs: 0 },
      { db: 1, keys: 10, expires: 0, avgTtlMs: 0 },
    ],
    modules: [],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: 12,
  },
  tlsCertificate: null,
};

const AUTH_REQUIRED: DiscoveryResult = {
  ...OPEN,
  host: '10.0.0.2',
  authRequired: true,
  anonymousStatus: 'auth_required',
  authenticatedStatus: 'not_attempted',
  version: null,
  product: 'unknown',
  inventory: null,
};

describe('toOsstatsXlsx', () => {
  it('produces a sheet named ClusterData, matching osstats', () => {
    const workbookXml = extractStoredEntry(
      toOsstatsXlsx([OPEN]),
      'xl/workbook.xml',
    )!.toString('utf8');
    expect(workbookXml).toContain('name="ClusterData"');
  });

  it('includes only the non-throughput columns osstats writes, in its order', () => {
    const xml = sheetXml(toOsstatsXlsx([OPEN]));
    for (const header of [
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
    ]) {
      expect(xml).toContain(header);
    }
    // The throughput/command-stats columns require a held-open connection and
    // a wait-then-resample of INFO COMMANDSTATS, which Redis Scanner never
    // does — they must never appear, fabricated or otherwise.
    for (const throughputColumn of [
      'Throughput (Ops)',
      'GetTypeCmds',
      'SetTypeCmds',
      'OtherTypeCmds',
      'HashBasedCmds',
    ]) {
      expect(xml).not.toContain(throughputColumn);
    }
  });

  it('maps host, role, version, os, and connection/replica counts', () => {
    const xml = sheetXml(toOsstatsXlsx([OPEN]));
    expect(xml).toContain('10.0.0.1'); // NodeId
    expect(xml).toContain('Master'); // NodeRole
    expect(xml).toContain('8.0.0'); // RedisVersion
    expect(xml).toContain('Linux x86_64'); // OS
    expect(xml).toContain('<v>12</v>'); // CurrConnections
    expect(xml).toContain('<v>1</v>'); // ConnectedSlaves (1 connected replica)
  });

  it('converts memory fields to GiB and reports raw peak bytes separately', () => {
    const xml = sheetXml(toOsstatsXlsx([OPEN]));
    expect(xml).toContain('<v>16</v>'); // TotalSystemMemory in GB
    expect(xml).toContain(`<v>${2 * 1024 ** 3}</v>`); // BytesUsedForCache, raw bytes
    expect(xml).toContain('<v>2</v>'); // MemoryUsed (Gb)
  });

  it('sums keyspace keys into CurrItems and formats Namespaces as db:count pairs', () => {
    const xml = sheetXml(toOsstatsXlsx([OPEN]));
    expect(xml).toContain('<v>15</v>'); // 5 + 10
    expect(xml).toContain('db0:5, db1:10');
  });

  it('represents ClusterEnabled as 0/1, matching osstats raw INFO representation', () => {
    // ClusterEnabled is column J (10th header): Source,ClusterId,NodeId,
    // NodeRole,RedisVersion,OS,TotalSystemMemory,BytesUsedForCache,
    // CurrConnections,ClusterEnabled. Anchored to the exact cell so this
    // can't pass by coincidentally matching some other 0/1-valued column.
    expect(sheetXml(toOsstatsXlsx([OPEN]))).toContain('<c r="J2"><v>0</v></c>'); // standalone
    const clustered: DiscoveryResult = {
      ...OPEN,
      inventory: { ...OPEN.inventory!, mode: 'cluster' },
    };
    expect(sheetXml(toOsstatsXlsx([clustered]))).toContain('<c r="J2"><v>1</v></c>');
  });

  it('leaves every inventory-derived cell blank when inventory is null — no fake data', () => {
    const xml = sheetXml(toOsstatsXlsx([AUTH_REQUIRED]));
    expect(xml).not.toContain('Master');
    expect(xml).not.toContain('8.0.0');
    // Source still reflects the real (if "unknown") classification, since
    // that comes from the probe itself, not from inventory.
    expect(xml).toContain('unknown');
  });

  it('produces one row per result', () => {
    const xml = sheetXml(toOsstatsXlsx([OPEN, AUTH_REQUIRED]));
    expect(xml).toContain('<row r="2">');
    expect(xml).toContain('<row r="3">');
    expect(xml).not.toContain('<row r="4">');
  });
});
