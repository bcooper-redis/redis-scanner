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
}

export interface ScanConfig {
  cidrs: string[];
  ports: number[];
  timeoutMs: number;
  tls: boolean;
  tlsSkipVerify: boolean;
  concurrency: number;
}

export interface AuthCredentials {
  username?: string;
  password: string;
}
