export type RedisProduct = 'redis' | 'valkey' | 'keydb' | 'enterprise' | 'unknown';

/** Human-readable product label — distinguishes OSS Redis from Enterprise. */
export function productDisplay(product: RedisProduct): string {
  return product === 'redis' ? 'redis OSS' : product;
}

export type AnonymousStatus = 'open' | 'auth_required' | 'unreachable' | 'error';

export type AuthenticatedStatus = 'authenticated' | 'auth_failed' | 'not_attempted';

export type RedisMode = 'standalone' | 'cluster' | 'sentinel';

export type RedisRole = 'master' | 'replica' | 'unknown';

export interface ReplicaInfo {
  ip: string;
  port: number;
  state: string;
  offset: number;
  lag: number;
}

export interface ReplicationInfo {
  connectedReplicas: ReplicaInfo[];
  masterHost: string | null;
  masterPort: number | null;
  masterLinkStatus: string | null;
}

export interface MemoryInfo {
  usedMemoryBytes: number | null;
  maxMemoryBytes: number | null;
  maxMemoryPolicy: string | null;
  totalSystemMemoryBytes: number | null;
  usedMemoryPeakBytes: number | null;
}

export interface KeyspaceDb {
  db: number;
  keys: number;
  expires: number;
  avgTtlMs: number;
}

export interface ModuleInfo {
  name: string;
  version: number;
  path: string;
}

export interface ClusterInfo {
  enabled: boolean;
  state: string | null;
  slotsAssigned: number;
  knownNodes: number;
  size: number;
}

export interface Inventory {
  redisVersion: string;
  mode: RedisMode;
  os: string;
  uptimeSeconds: number;
  role: RedisRole;
  replication: ReplicationInfo;
  memory: MemoryInfo;
  keyspace: KeyspaceDb[];
  modules: ModuleInfo[];
  clusterInfo: ClusterInfo | null;
  /** INFO's run_id — unique per running redis-server process. */
  runId: string | null;
  connectedClients: number | null;
}

export interface TlsCertificateInfo {
  /** Formatted distinguished name — the CN if present, else "K=V, ..." for whatever fields exist. */
  subject: string | null;
  issuer: string | null;
  validFrom: string | null;
  validTo: string | null;
  /** True when the certificate's issuer is its own subject (signed by itself, not a CA). */
  selfSigned: boolean;
  /** True when the chain validated against Node's trusted CA store. */
  trusted: boolean;
  fingerprint256: string | null;
}

export interface DiscoveryResult {
  host: string;
  port: number;
  tls: boolean;
  product: RedisProduct;
  version: string | null;
  authRequired: boolean;
  anonymousStatus: AnonymousStatus;
  authenticatedStatus: AuthenticatedStatus;
  latency: number;
  inventory: Inventory | null;
  /**
   * Read from the TLS handshake itself, independent of Redis-level auth —
   * populated even when the server requires authentication we don't have,
   * since it never depends on getting past AUTH/PING at all. Null for
   * plaintext connections or when TLS wasn't attempted.
   */
  tlsCertificate: TlsCertificateInfo | null;
}

/**
 * Groups results that share the same non-null run_id — the same running
 * redis-server process reachable through more than one host:port. Common
 * behind a proxy layer (e.g. Redis Enterprise answers a database's port on
 * every cluster node), where independent host:port probes would otherwise
 * look like separate instances even though they're the same database. Only
 * returns groups of 2+; a unique or missing run_id produces no group.
 */
export function findRunIdDuplicates(results: DiscoveryResult[]): DiscoveryResult[][] {
  const byRunId = new Map<string, DiscoveryResult[]>();
  for (const r of results) {
    const runId = r.inventory?.runId;
    if (!runId) continue;
    const group = byRunId.get(runId);
    if (group) group.push(r);
    else byRunId.set(runId, [r]);
  }
  return Array.from(byRunId.values()).filter((group) => group.length > 1);
}

/**
 * Collapses each run_id-duplicate group down to its first occurrence —
 * the same database found at N endpoints is kept once rather than N times.
 * Results without a run_id (e.g. auth required, inventory unavailable) are
 * never treated as duplicates and always pass through untouched, since
 * there's no evidence they're the same database as anything else.
 * Order-preserving: with discover()'s grouping-aware sort, the surviving
 * result is the earliest-sorting member of its group.
 */
export function dedupeByRunId(results: DiscoveryResult[]): DiscoveryResult[] {
  const seenRunIds = new Set<string>();
  return results.filter((r) => {
    const runId = r.inventory?.runId;
    if (!runId) return true;
    if (seenRunIds.has(runId)) return false;
    seenRunIds.add(runId);
    return true;
  });
}

function compareHostPort(a: DiscoveryResult, b: DiscoveryResult): number {
  return a.host.localeCompare(b.host) || a.port - b.port;
}

/**
 * Sorts by host then port, except results that share a run_id (the same
 * database reachable through more than one endpoint) are kept adjacent —
 * clustered at the position of the earliest-sorting member of their group —
 * instead of scattered wherever their own host happens to fall. Shared by
 * every scan pipeline (discover(), credentialScan()) so results always read
 * the same way regardless of how they were found.
 */
export function sortWithRunIdGrouping(results: DiscoveryResult[]): DiscoveryResult[] {
  const groupAnchor = new Map<DiscoveryResult, DiscoveryResult>();
  for (const group of findRunIdDuplicates(results)) {
    const earliest = [...group].sort(compareHostPort)[0];
    for (const r of group) groupAnchor.set(r, earliest);
  }

  return [...results].sort((a, b) => {
    const anchorA = groupAnchor.get(a) ?? a;
    const anchorB = groupAnchor.get(b) ?? b;
    return compareHostPort(anchorA, anchorB) || compareHostPort(a, b);
  });
}

export interface ScanConfig {
  cidrs: string[];
  ports: number[];
  timeoutMs: number;
  tls: boolean;
  tlsSkipVerify: boolean;
  concurrency: number;
  /** Bypasses the large-scan warning (see scanner/scanSize.ts). Defaults to false. */
  force?: boolean;
}

export interface AuthCredentials {
  username?: string;
  password: string;
}
