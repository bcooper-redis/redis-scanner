import { describe, it, expect } from 'vitest';
import {
  parseInfo,
  parseModuleList,
  parseClusterInfo,
  refineProductWithModules,
} from '../../../src/probe/info';

// Minimal but realistic INFO fixtures for each version range

const REDIS_6X = `
# Server
redis_version:6.2.14
redis_git_sha1:00000000
redis_git_dirty:0
redis_mode:standalone
os:Linux 5.15.0 x86_64
arch_bits:64
process_id:1
uptime_in_seconds:3600
uptime_in_days:0
hz:10
role:master
# Memory
maxmemory:0
`.trim();

// Redis Enterprise never sets server_name and omits maxmemory from the
// Memory section entirely — structure verified against a live Redis Cloud
// instance (see src/probe/info.ts's detectProduct for the reasoning).
const REDIS_ENTERPRISE = `
# Server
redis_version:8.6.2
redis_git_sha1:00000000
redis_git_dirty:0
redis_mode:standalone
os:Linux 6.8.0-1053-aws aarch64
uptime_in_seconds:5176914
role:master
# Memory
used_memory:2484368
maxmemory_policy:volatile-lru
# Keyspace
db0:keys=69,expires=0,avg_ttl=0
`.trim();

// Redis 7.4+ added server_name
const REDIS_7X = `
# Server
redis_version:7.4.0
server_name:redis
redis_mode:standalone
os:Linux 6.1.0 x86_64
uptime_in_seconds:86400
uptime_in_days:1
role:master
`.trim();

const REDIS_8X = `
# Server
redis_version:8.2.2
server_name:redis
redis_mode:standalone
os:Linux 6.10.14-linuxkit aarch64
uptime_in_seconds:1745
uptime_in_days:0
role:master
`.trim();

const VALKEY = `
# Server
redis_version:8.0.0
server_name:valkey
redis_mode:standalone
os:Linux 5.15.0 x86_64
uptime_in_seconds:7200
role:master
`.trim();

// redis_version is Valkey's fixed Redis-compatibility marker, not its own
// release — verified live against a real Valkey 9.1.0 instance (see
// src/probe/info.ts's parseVersion).
const VALKEY_WITH_OWN_VERSION = `
# Server
redis_version:7.2.4
server_name:valkey
valkey_version:9.1.0
redis_mode:standalone
os:Linux 6.10.14-linuxkit aarch64
uptime_in_seconds:196
role:master
`.trim();

const CLUSTER_NODE = `
# Server
redis_version:7.2.0
server_name:redis
redis_mode:cluster
os:Linux 5.15.0 x86_64
uptime_in_seconds:43200
role:master
`.trim();

const REPLICA = `
# Server
redis_version:7.2.0
server_name:redis
redis_mode:standalone
os:Linux 5.15.0 x86_64
uptime_in_seconds:43200
role:slave
# Replication
master_host:10.0.0.1
master_port:6379
master_link_status:up
`.trim();

const MASTER_WITH_REPLICAS = `
# Server
redis_version:7.2.0
redis_mode:standalone
role:master
# Replication
connected_slaves:2
slave0:ip=127.0.0.1,port=6380,state=online,offset=14,lag=0
slave1:ip=127.0.0.1,port=6381,state=online,offset=14,lag=1
`.trim();

const WITH_RUN_ID = `
# Server
redis_version:8.2.2
run_id:a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1
role:master
`.trim();

const WITH_MEMORY = `
# Memory
used_memory:1035520
maxmemory:104857600
maxmemory_policy:allkeys-lru
`.trim();

const WITH_UNLIMITED_MEMORY = `
# Memory
used_memory:1035520
maxmemory:0
maxmemory_policy:noeviction
`.trim();

const WITH_KEYSPACE = `
# Keyspace
db0:keys=5,expires=1,avg_ttl=0
db1:keys=2,expires=0,avg_ttl=0
`.trim();

const EMPTY = '';

describe('parseInfo — product detection', () => {
  it('detects redis on 6.x (no server_name field)', () => {
    expect(parseInfo(REDIS_6X).product).toBe('redis');
  });

  it('detects redis on 7.4+ (server_name:redis)', () => {
    expect(parseInfo(REDIS_7X).product).toBe('redis');
  });

  it('detects redis on 8.x', () => {
    expect(parseInfo(REDIS_8X).product).toBe('redis');
  });

  it('detects valkey', () => {
    expect(parseInfo(VALKEY).product).toBe('valkey');
  });

  it('detects enterprise (no server_name + no maxmemory field, but a real version)', () => {
    expect(parseInfo(REDIS_ENTERPRISE).product).toBe('enterprise');
  });

  it('does not misclassify a real OSS instance missing server_name as enterprise', () => {
    // REDIS_6X has no server_name (pre-7.4) but does report maxmemory, like
    // every real OSS build — must not trip the enterprise heuristic.
    expect(parseInfo(REDIS_6X).product).toBe('redis');
  });

  it('falls back to redis for a totally empty/failed INFO response', () => {
    // No redis_version parsed at all — must not default to 'enterprise' just
    // because maxmemory also happens to be absent.
    expect(parseInfo(EMPTY).product).toBe('redis');
  });
});

describe('parseInfo — version', () => {
  it('parses 6.x version', () => {
    expect(parseInfo(REDIS_6X).version).toBe('6.2.14');
  });

  it('parses 7.x version', () => {
    expect(parseInfo(REDIS_7X).version).toBe('7.4.0');
  });

  it('parses 8.x version', () => {
    expect(parseInfo(REDIS_8X).version).toBe('8.2.2');
  });

  it('returns null for empty input', () => {
    expect(parseInfo(EMPTY).version).toBeNull();
  });

  it('falls back to redis_version for a valkey instance with no valkey_version field', () => {
    expect(parseInfo(VALKEY).version).toBe('8.0.0');
  });

  it('prefers valkey_version over redis_version when both are present', () => {
    const info = parseInfo(VALKEY_WITH_OWN_VERSION);
    expect(info.product).toBe('valkey');
    expect(info.version).toBe('9.1.0');
  });
});

describe('parseInfo — mode', () => {
  it('parses standalone', () => {
    expect(parseInfo(REDIS_6X).mode).toBe('standalone');
  });

  it('parses cluster', () => {
    expect(parseInfo(CLUSTER_NODE).mode).toBe('cluster');
  });

  it('returns null for empty input', () => {
    expect(parseInfo(EMPTY).mode).toBeNull();
  });
});

describe('parseInfo — role', () => {
  it('parses master role', () => {
    expect(parseInfo(REDIS_8X).role).toBe('master');
  });

  it('normalises slave → replica', () => {
    expect(parseInfo(REPLICA).role).toBe('replica');
  });

  it('returns null for missing role', () => {
    expect(parseInfo(EMPTY).role).toBeNull();
  });
});

describe('parseInfo — uptime and os', () => {
  it('parses uptime as integer', () => {
    expect(parseInfo(REDIS_8X).uptimeSeconds).toBe(1745);
  });

  it('parses os string', () => {
    expect(parseInfo(REDIS_8X).os).toBe('Linux 6.10.14-linuxkit aarch64');
  });

  it('returns null for missing fields', () => {
    const result = parseInfo(EMPTY);
    expect(result.uptimeSeconds).toBeNull();
    expect(result.os).toBeNull();
  });
});

describe('parseInfo — resilience', () => {
  it('ignores comment lines', () => {
    const result = parseInfo('# Server\nredis_version:7.0.0\n# comment\nrole:master');
    expect(result.version).toBe('7.0.0');
    expect(result.role).toBe('master');
  });

  it('handles Windows-style CRLF line endings', () => {
    const result = parseInfo('redis_version:7.0.0\r\nrole:master\r\n');
    expect(result.version).toBe('7.0.0');
  });

  it('handles values that contain colons (os field)', () => {
    const result = parseInfo('os:Linux 5.15.0-1045-aws x86_64\nredis_version:7.0.0');
    expect(result.os).toBe('Linux 5.15.0-1045-aws x86_64');
  });
});

describe('parseInfo — replication', () => {
  it('returns empty replicas and null master fields by default', () => {
    const result = parseInfo(REDIS_8X);
    expect(result.replication.connectedReplicas).toEqual([]);
    expect(result.replication.masterHost).toBeNull();
    expect(result.replication.masterPort).toBeNull();
    expect(result.replication.masterLinkStatus).toBeNull();
  });

  it('parses connected replicas on a master', () => {
    const { connectedReplicas } = parseInfo(MASTER_WITH_REPLICAS).replication;
    expect(connectedReplicas).toHaveLength(2);
    expect(connectedReplicas[0]).toEqual({
      ip: '127.0.0.1',
      port: 6380,
      state: 'online',
      offset: 14,
      lag: 0,
    });
    expect(connectedReplicas[1]).toEqual({
      ip: '127.0.0.1',
      port: 6381,
      state: 'online',
      offset: 14,
      lag: 1,
    });
  });

  it('parses master host/port/link status on a replica', () => {
    const { replication } = parseInfo(REPLICA);
    expect(replication.masterHost).toBe('10.0.0.1');
    expect(replication.masterPort).toBe(6379);
    expect(replication.masterLinkStatus).toBe('up');
    expect(replication.connectedReplicas).toEqual([]);
  });
});

describe('parseInfo — run_id', () => {
  it('is null when run_id is absent', () => {
    expect(parseInfo(REDIS_8X).runId).toBeNull();
  });

  it('parses run_id when present', () => {
    expect(parseInfo(WITH_RUN_ID).runId).toBe('a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1');
  });
});

describe('parseInfo — memory', () => {
  it('parses used memory, max memory, and policy', () => {
    const { memory } = parseInfo(WITH_MEMORY);
    expect(memory.usedMemoryBytes).toBe(1035520);
    expect(memory.maxMemoryBytes).toBe(104857600);
    expect(memory.maxMemoryPolicy).toBe('allkeys-lru');
  });

  it('treats maxmemory:0 as no limit (null), not a zero-byte cap', () => {
    const { memory } = parseInfo(WITH_UNLIMITED_MEMORY);
    expect(memory.maxMemoryBytes).toBeNull();
    expect(memory.usedMemoryBytes).toBe(1035520);
  });

  it('returns nulls when memory fields are absent', () => {
    const { memory } = parseInfo(EMPTY);
    expect(memory.usedMemoryBytes).toBeNull();
    expect(memory.maxMemoryBytes).toBeNull();
    expect(memory.maxMemoryPolicy).toBeNull();
  });
});

describe('parseInfo — keyspace', () => {
  it('parses per-db key counts', () => {
    const keyspace = parseInfo(WITH_KEYSPACE).keyspace;
    expect(keyspace).toEqual([
      { db: 0, keys: 5, expires: 1, avgTtlMs: 0 },
      { db: 1, keys: 2, expires: 0, avgTtlMs: 0 },
    ]);
  });

  it('returns an empty array when there are no keys', () => {
    expect(parseInfo(EMPTY).keyspace).toEqual([]);
  });
});

describe('parseModuleList', () => {
  it('parses a minimal name/ver-only reply shape', () => {
    const raw = [
      ['name', 'search', 'ver', 20811],
      ['name', 'ReJSON', 'ver', 20609],
    ];
    expect(parseModuleList(raw)).toEqual([
      { name: 'search', version: 20811, path: '' },
      { name: 'ReJSON', version: 20609, path: '' },
    ]);
  });

  it('parses the full real-world reply shape (name/ver/path/args), as seen on Redis Enterprise', () => {
    // Verbatim structure from a live Redis Cloud MODULE LIST reply.
    const raw = [
      ['name', 'search', 'ver', 80606, 'path', '/enterprise-managed', 'args', []],
      ['name', 'ReJSON', 'ver', 80603, 'path', '/enterprise-managed', 'args', []],
    ];
    expect(parseModuleList(raw)).toEqual([
      { name: 'search', version: 80606, path: '/enterprise-managed' },
      { name: 'ReJSON', version: 80603, path: '/enterprise-managed' },
    ]);
  });

  it('returns an empty array for a non-array reply', () => {
    expect(parseModuleList(null)).toEqual([]);
    expect(parseModuleList(undefined)).toEqual([]);
    expect(parseModuleList('unexpected')).toEqual([]);
  });

  it('returns an empty array for an empty module list', () => {
    expect(parseModuleList([])).toEqual([]);
  });

  it('skips malformed entries missing a name', () => {
    const raw = [['ver', 123]];
    expect(parseModuleList(raw)).toEqual([]);
  });
});

describe('refineProductWithModules', () => {
  const enterpriseManagedModule = { name: 'search', version: 80606, path: '/enterprise-managed' };
  const realPathModule = {
    name: 'search',
    version: 20811,
    path: '/usr/lib/redis/modules/redisearch.so',
  };

  it("upgrades 'redis' to 'enterprise' when a module reports the enterprise-managed path", () => {
    expect(refineProductWithModules('redis', [enterpriseManagedModule])).toBe('enterprise');
  });

  it('leaves the product alone when modules use real filesystem paths', () => {
    expect(refineProductWithModules('redis', [realPathModule])).toBe('redis');
  });

  it('leaves the product alone when there are no modules', () => {
    expect(refineProductWithModules('redis', [])).toBe('redis');
  });

  it('never overrides an already-confident valkey/keydb/enterprise classification', () => {
    expect(refineProductWithModules('valkey', [enterpriseManagedModule])).toBe('valkey');
    expect(refineProductWithModules('keydb', [enterpriseManagedModule])).toBe('keydb');
    expect(refineProductWithModules('enterprise', [enterpriseManagedModule])).toBe('enterprise');
    expect(refineProductWithModules('unknown', [enterpriseManagedModule])).toBe('unknown');
  });
});

describe('parseClusterInfo', () => {
  it('parses cluster state fields', () => {
    const raw =
      'cluster_enabled:1\r\ncluster_state:ok\r\ncluster_slots_assigned:16384\r\ncluster_known_nodes:6\r\ncluster_size:3\r\n';
    expect(parseClusterInfo(raw)).toEqual({
      enabled: true,
      state: 'ok',
      slotsAssigned: 16384,
      knownNodes: 6,
      size: 3,
    });
  });

  it('defaults numeric fields to 0 and state to null when absent', () => {
    expect(parseClusterInfo('')).toEqual({
      enabled: false,
      state: null,
      slotsAssigned: 0,
      knownNodes: 0,
      size: 0,
    });
  });
});
