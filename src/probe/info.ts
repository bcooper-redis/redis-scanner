import type {
  RedisProduct,
  RedisMode,
  RedisRole,
  ReplicationInfo,
  ReplicaInfo,
  MemoryInfo,
  KeyspaceDb,
  ModuleInfo,
  ClusterInfo,
} from '../types';

export interface ParsedInfo {
  product: RedisProduct;
  version: string | null;
  mode: RedisMode | null;
  os: string | null;
  uptimeSeconds: number | null;
  role: RedisRole | null;
  replication: ReplicationInfo;
  memory: MemoryInfo;
  keyspace: KeyspaceDb[];
  runId: string | null;
  connectedClients: number | null;
}

/**
 * Parse the raw string returned by `INFO` into typed fields, covering the
 * Server, Replication, Memory, and Keyspace sections. All fields are
 * optional — absent or unrecognised values become null/empty.
 */
export function parseInfo(raw: string): ParsedInfo {
  const fields = parseFields(raw);
  return {
    product: detectProduct(fields),
    version: fields.get('redis_version') ?? null,
    mode: normaliseMode(fields.get('redis_mode')),
    os: fields.get('os') ?? null,
    uptimeSeconds: parseOptionalInt(fields.get('uptime_in_seconds')),
    role: normaliseRole(fields.get('role')),
    replication: parseReplication(fields),
    memory: parseMemory(fields),
    keyspace: parseKeyspace(fields),
    runId: fields.get('run_id') ?? null,
    connectedClients: parseOptionalInt(fields.get('connected_clients')),
  };
}

function parseFields(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    map.set(trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim());
  }
  return map;
}

/** Parses a comma-separated key=value list, e.g. "ip=127.0.0.1,port=6380,state=online". */
function parseKeyValueList(raw: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of raw.split(',')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    map.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
  }
  return map;
}

function detectProduct(fields: Map<string, string>): RedisProduct {
  const name = fields.get('server_name')?.toLowerCase();
  // server_name was added in Redis 7.4+ and Valkey forks.
  // Absent on Redis 6.x and early 7.x — default to 'redis'.
  // KeyDB detection via server_name:'keydb' is unverified against a live
  // KeyDB instance — may need a different signal if it doesn't hold up.
  if (name === 'valkey') return 'valkey';
  if (name === 'keydb') return 'keydb';
  if (name === 'redis') return 'redis';
  if (!name) {
    // No server_name: either Redis <7.4/Valkey<7.4, or Redis Enterprise, which
    // never sets server_name at all (verified against a live Redis Cloud
    // instance). Enterprise's managed INFO output omits `maxmemory` from the
    // Memory section entirely, whereas standard OSS always reports it (even
    // as 0) — use that structural gap as the tie-breaker. Gated on actually
    // having parsed a version so a totally empty/failed INFO response falls
    // through to the safe 'redis' default instead of being misread as
    // Enterprise. Based on a single verified sample — worth re-checking
    // against another Enterprise/Cloud deployment if this misfires.
    if (fields.has('redis_version') && !fields.has('maxmemory')) return 'enterprise';
    return 'redis';
  }
  return 'unknown';
}

function normaliseMode(raw: string | undefined): RedisMode | null {
  if (raw === 'standalone') return 'standalone';
  if (raw === 'cluster') return 'cluster';
  if (raw === 'sentinel') return 'sentinel';
  return null;
}

function normaliseRole(raw: string | undefined): RedisRole | null {
  if (raw === 'master') return 'master';
  // Redis INFO uses 'slave'; Valkey may use 'replica'
  if (raw === 'slave' || raw === 'replica') return 'replica';
  return null;
}

function parseOptionalInt(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const n = parseInt(raw, 10);
  return isNaN(n) ? null : n;
}

function parseReplication(fields: Map<string, string>): ReplicationInfo {
  const connectedReplicas: ReplicaInfo[] = [];
  for (const [key, value] of fields) {
    if (!/^slave\d+$/.test(key)) continue;
    const kv = parseKeyValueList(value);
    const port = parseInt(kv.get('port') ?? '', 10);
    const offset = parseInt(kv.get('offset') ?? '', 10);
    const lag = parseInt(kv.get('lag') ?? '', 10);
    connectedReplicas.push({
      ip: kv.get('ip') ?? '',
      port: isNaN(port) ? 0 : port,
      state: kv.get('state') ?? '',
      offset: isNaN(offset) ? 0 : offset,
      lag: isNaN(lag) ? 0 : lag,
    });
  }

  const masterPort = parseOptionalInt(fields.get('master_port'));

  return {
    connectedReplicas,
    masterHost: fields.get('master_host') ?? null,
    masterPort,
    masterLinkStatus: fields.get('master_link_status') ?? null,
  };
}

function parseMemory(fields: Map<string, string>): MemoryInfo {
  const maxMemory = parseOptionalInt(fields.get('maxmemory'));
  return {
    usedMemoryBytes: parseOptionalInt(fields.get('used_memory')),
    // maxmemory:0 means "no limit" — surface as null rather than a misleading 0-byte cap.
    maxMemoryBytes: maxMemory === 0 ? null : maxMemory,
    maxMemoryPolicy: fields.get('maxmemory_policy') ?? null,
    totalSystemMemoryBytes: parseOptionalInt(fields.get('total_system_memory')),
    usedMemoryPeakBytes: parseOptionalInt(fields.get('used_memory_peak')),
  };
}

function parseKeyspace(fields: Map<string, string>): KeyspaceDb[] {
  const dbs: KeyspaceDb[] = [];
  for (const [key, value] of fields) {
    const match = /^db(\d+)$/.exec(key);
    if (!match) continue;
    const kv = parseKeyValueList(value);
    const keys = parseInt(kv.get('keys') ?? '', 10);
    const expires = parseInt(kv.get('expires') ?? '', 10);
    const avgTtl = parseInt(kv.get('avg_ttl') ?? '', 10);
    dbs.push({
      db: parseInt(match[1], 10),
      keys: isNaN(keys) ? 0 : keys,
      expires: isNaN(expires) ? 0 : expires,
      avgTtlMs: isNaN(avgTtl) ? 0 : avgTtl,
    });
  }
  return dbs.sort((a, b) => a.db - b.db);
}

/**
 * Parse the reply from `MODULE LIST` — an array of arrays, each a flat
 * name/value list (RESP2 has no native map type). Malformed or unsupported
 * replies degrade to an empty list rather than throwing.
 */
export function parseModuleList(raw: unknown): ModuleInfo[] {
  if (!Array.isArray(raw)) return [];
  const modules: ModuleInfo[] = [];
  for (const entry of raw) {
    if (!Array.isArray(entry)) continue;
    let name: string | null = null;
    let version = 0;
    let path = '';
    // Real replies have more than just name/ver (path, args, ...) — walk all
    // pairs rather than assuming exactly 4 elements.
    for (let i = 0; i + 1 < entry.length; i += 2) {
      const key = String(entry[i]).toLowerCase();
      if (key === 'name') name = String(entry[i + 1]);
      if (key === 'ver') version = Number(entry[i + 1]) || 0;
      if (key === 'path') path = String(entry[i + 1]);
    }
    if (name !== null) modules.push({ name, version, path });
  }
  return modules;
}

/**
 * Redis Enterprise reports every loaded module's path as the literal string
 * "/enterprise-managed" rather than a real filesystem path — verified
 * against a live Redis Cloud instance. This is a more explicit signal than
 * detectProduct's maxmemory-absence heuristic, but only available when at
 * least one module is loaded, so it's applied as a refinement on top of
 * (never instead of) the INFO-based detection — it only ever upgrades an
 * ambiguous 'redis' classification, never overrides an explicit
 * valkey/keydb match from server_name.
 */
export function refineProductWithModules(
  product: RedisProduct,
  modules: ModuleInfo[],
): RedisProduct {
  if (product !== 'redis') return product;
  const enterpriseManaged = modules.some((m) => m.path === '/enterprise-managed');
  return enterpriseManaged ? 'enterprise' : product;
}

/** Parses the reply from `CLUSTER INFO`, which uses the same key:value format as INFO. */
export function parseClusterInfo(raw: string): ClusterInfo {
  const fields = parseFields(raw);
  return {
    enabled: fields.get('cluster_enabled') === '1',
    state: fields.get('cluster_state') ?? null,
    slotsAssigned: parseOptionalInt(fields.get('cluster_slots_assigned')) ?? 0,
    knownNodes: parseOptionalInt(fields.get('cluster_known_nodes')) ?? 0,
    size: parseOptionalInt(fields.get('cluster_size')) ?? 0,
  };
}
