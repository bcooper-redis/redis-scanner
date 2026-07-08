import type { TcpProbeResult } from '../scanner/tcp';
import type { ProbeResult } from '../probe/index';
import type {
  DiscoveryResult,
  Inventory,
  AnonymousStatus,
  AuthenticatedStatus,
  RedisRole,
  RedisMode,
} from '../types';

function toRole(role: ProbeResult['role']): RedisRole {
  return role ?? 'unknown';
}

function toMode(mode: ProbeResult['mode']): RedisMode {
  return mode ?? 'standalone';
}

function buildInventory(probe: ProbeResult): Inventory | null {
  if (!probe.isRedis || probe.authRequired || probe.version === null) return null;
  return {
    redisVersion: probe.version,
    mode: toMode(probe.mode),
    os: probe.os ?? '',
    uptimeSeconds: probe.uptimeSeconds ?? 0,
    role: toRole(probe.role),
    replication: probe.replication,
    memory: probe.memory,
    keyspace: probe.keyspace,
    modules: probe.modules,
    clusterInfo: probe.clusterInfo,
    runId: probe.runId,
    connectedClients: probe.connectedClients,
  };
}

function deriveAnonymousStatus(probe: ProbeResult): AnonymousStatus {
  if (!probe.isRedis) return 'error';
  if (probe.authRequired) return 'auth_required';
  return 'open';
}

function deriveAuthenticatedStatus(
  probe: ProbeResult,
  credentialsProvided: boolean,
): AuthenticatedStatus {
  if (!credentialsProvided) return 'not_attempted';
  if (probe.wrongPassword) return 'auth_failed';
  return 'authenticated';
}

/**
 * Combine a TCP probe result and a Redis probe result into a DiscoveryResult.
 * Pure function — no I/O.
 */
export function assembleResult(
  tcp: TcpProbeResult,
  probe: ProbeResult,
  credentialsProvided: boolean,
): DiscoveryResult {
  return {
    host: tcp.host,
    port: tcp.port,
    tls: probe.tls,
    product: probe.product,
    version: probe.version,
    authRequired: probe.authRequired,
    anonymousStatus: deriveAnonymousStatus(probe),
    authenticatedStatus: deriveAuthenticatedStatus(probe, credentialsProvided),
    latency: tcp.latencyMs,
    inventory: buildInventory(probe),
    tlsCertificate: probe.tlsCertificate,
  };
}
