import { describe, it, expect, beforeEach } from 'vitest';
import { createState } from '../../../src/web/state';
import type { AppState } from '../../../src/web/state';
import { createScanController } from '../../../src/scanner/control';
import type { DiscoveryResult, ScanConfig } from '../../../src/types';

const CONFIG: ScanConfig = {
  cidrs: ['10.0.0.0/24'],
  ports: [6379],
  timeoutMs: 1000,
  tls: false,
  tlsSkipVerify: false,
  concurrency: 100,
};

function startScan(state: AppState, targets: string[], autoDetected: boolean) {
  return state.startScan(targets, autoDetected, { ...CONFIG, cidrs: targets }, createScanController());
}

const RESULT: DiscoveryResult = {
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
    runId: null,
    connectedClients: null,
  },
  tlsCertificate: null,
};

let state: AppState;
beforeEach(() => {
  state = createState();
});

describe('initial state', () => {
  it('starts idle with empty results', () => {
    const s = state.getState();
    expect(s.status).toBe('idle');
    expect(s.results).toEqual([]);
    expect(s.error).toBeNull();
    expect(s.progress.scanTotal).toBe(0);
    expect(s.targets).toEqual([]);
    expect(s.autoDetected).toBe(false);
    expect(s.elapsedMs).toBeNull();
  });
});

describe('startScan', () => {
  it('transitions to scanning and clears previous results', () => {
    state.finishScan([RESULT]);
    startScan(state, ['10.0.0.0/24'], false);
    const s = state.getState();
    expect(s.status).toBe('scanning');
    expect(s.results).toEqual([]);
    expect(s.progress.scanDone).toBe(0);
  });

  it('records the submitted targets and autoDetected flag', () => {
    startScan(state, ['10.0.0.0/24', 'redis.example.com'], false);
    const s = state.getState();
    expect(s.targets).toEqual(['10.0.0.0/24', 'redis.example.com']);
    expect(s.autoDetected).toBe(false);
  });

  it('records autoDetected when targets came from local subnet detection', () => {
    startScan(state, ['192.168.1.0/24'], true);
    const s = state.getState();
    expect(s.targets).toEqual(['192.168.1.0/24']);
    expect(s.autoDetected).toBe(true);
  });
});

describe('updateScanProgress', () => {
  it('updates scanDone and scanTotal', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.updateScanProgress(42, 254);
    expect(state.getState().progress.scanDone).toBe(42);
    expect(state.getState().progress.scanTotal).toBe(254);
  });
});

describe('updateProbeProgress', () => {
  it('updates probeDone and probeTotal', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.updateProbeProgress(2, 5);
    expect(state.getState().progress.probeDone).toBe(2);
    expect(state.getState().progress.probeTotal).toBe(5);
  });
});

describe('finishScan', () => {
  it('transitions to done and stores results', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.finishScan([RESULT]);
    const s = state.getState();
    expect(s.status).toBe('done');
    expect(s.results).toHaveLength(1);
    expect(s.results[0].host).toBe('10.0.0.1');
  });

  it('preserves targets and autoDetected through to done', () => {
    startScan(state, ['10.0.0.0/24'], true);
    state.finishScan([RESULT]);
    const s = state.getState();
    expect(s.targets).toEqual(['10.0.0.0/24']);
    expect(s.autoDetected).toBe(true);
  });
});

describe('failScan', () => {
  it('transitions to error with message', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.failScan('connection refused');
    const s = state.getState();
    expect(s.status).toBe('error');
    expect(s.error).toBe('connection refused');
  });
});

describe('pauseScan / resumeScan', () => {
  it('pauseScan moves scanning to paused', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.pauseScan();
    expect(state.getState().status).toBe('paused');
  });

  it('pauseScan is a no-op when not scanning', () => {
    state.pauseScan();
    expect(state.getState().status).toBe('idle');
  });

  it('resumeScan moves paused back to scanning', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.pauseScan();
    state.resumeScan();
    expect(state.getState().status).toBe('scanning');
  });

  it('resumeScan is a no-op when not paused', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.resumeScan();
    expect(state.getState().status).toBe('scanning');
  });
});

describe('markStopped', () => {
  it('moves scanning to stopped', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.markStopped();
    expect(state.getState().status).toBe('stopped');
  });

  it('moves paused to stopped', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.pauseScan();
    state.markStopped();
    expect(state.getState().status).toBe('stopped');
  });

  it('is a no-op when idle', () => {
    state.markStopped();
    expect(state.getState().status).toBe('idle');
  });

  it('a later finishScan for the same run does not overwrite stopped', () => {
    startScan(state, ['10.0.0.0/24'], false);
    state.markStopped();
    state.finishScan([RESULT]);
    expect(state.getState().status).toBe('stopped');
  });
});

describe('lastConfig / controller / generation', () => {
  it('has no lastConfig or controller before any scan has run', () => {
    expect(state.getLastConfig()).toBeNull();
    expect(state.getController()).toBeNull();
  });

  it('startScan stores the config and controller for later retrieval', () => {
    const controller = createScanController();
    state.startScan(['10.0.0.0/24'], false, { ...CONFIG, cidrs: ['10.0.0.0/24'] }, controller);
    expect(state.getLastConfig()).toEqual({ ...CONFIG, cidrs: ['10.0.0.0/24'] });
    expect(state.getController()).toBe(controller);
  });

  it('startScan returns an incrementing generation each call', () => {
    const gen1 = startScan(state, ['10.0.0.0/24'], false);
    const gen2 = startScan(state, ['10.0.0.0/24'], false);
    expect(gen2).toBeGreaterThan(gen1);
    expect(state.getGeneration()).toBe(gen2);
  });

  it('resetState bumps the generation, invalidating any in-flight run', () => {
    const gen = startScan(state, ['10.0.0.0/24'], false);
    state.resetState();
    expect(state.getGeneration()).not.toBe(gen);
    expect(state.getLastConfig()).toBeNull();
    expect(state.getController()).toBeNull();
  });
});

describe('elapsedMs', () => {
  function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  it('is null before any scan has run', () => {
    expect(state.getState().elapsedMs).toBeNull();
  });

  it('increases with real time while scanning', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    const first = state.getState().elapsedMs;
    expect(first).not.toBeNull();

    await delay(50);
    const second = state.getState().elapsedMs;
    expect(second!).toBeGreaterThan(first!);
    expect(second!).toBeGreaterThanOrEqual(40);
  });

  it('freezes while paused', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(30);
    state.pauseScan();
    const atPause = state.getState().elapsedMs;

    await delay(60);
    expect(state.getState().elapsedMs).toBe(atPause);
  });

  it('continues from where it left off after resume, excluding the paused gap', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(30);
    state.pauseScan();
    const atPause = state.getState().elapsedMs!;

    await delay(80); // paused gap — must not count toward elapsed
    state.resumeScan();
    const justAfterResume = state.getState().elapsedMs!;
    expect(justAfterResume).toBeGreaterThanOrEqual(atPause);
    expect(justAfterResume).toBeLessThan(atPause + 30);

    await delay(30);
    expect(state.getState().elapsedMs!).toBeGreaterThan(justAfterResume);
  });

  it('freezes once the scan finishes', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(30);
    state.finishScan([RESULT]);
    const atFinish = state.getState().elapsedMs;

    await delay(50);
    expect(state.getState().elapsedMs).toBe(atFinish);
  });

  it('freezes once the scan errors', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(30);
    state.failScan('boom');
    const atFail = state.getState().elapsedMs;

    await delay(50);
    expect(state.getState().elapsedMs).toBe(atFail);
  });

  it('excludes a trailing paused gap when stopped while paused', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(30);
    state.pauseScan();
    const atPause = state.getState().elapsedMs!;

    await delay(80); // paused gap — stopping now must not count this either
    state.markStopped();
    const atStop = state.getState().elapsedMs!;
    expect(atStop).toBeGreaterThanOrEqual(atPause);
    expect(atStop).toBeLessThan(atPause + 30);
  });

  it('resets to near-zero on a fresh startScan (covers Restart)', async () => {
    startScan(state, ['10.0.0.0/24'], false);
    await delay(50);
    state.finishScan([RESULT]);
    expect(state.getState().elapsedMs!).toBeGreaterThanOrEqual(40);

    startScan(state, ['10.0.0.0/24'], false);
    expect(state.getState().elapsedMs!).toBeLessThan(20);
  });
});

describe('updateResult', () => {
  it('replaces a result by host+port', () => {
    state.finishScan([RESULT]);
    const updated: DiscoveryResult = {
      ...RESULT,
      authenticatedStatus: 'authenticated',
    };
    state.updateResult(updated);
    expect(state.getState().results[0].authenticatedStatus).toBe('authenticated');
  });

  it('appends when host+port not found, instead of dropping the update', () => {
    state.finishScan([RESULT]);
    state.updateResult({ ...RESULT, host: '99.99.99.99' });
    expect(state.getState().results).toHaveLength(2);
    expect(state.getState().results[0].host).toBe('10.0.0.1');
    expect(state.getState().results[1].host).toBe('99.99.99.99');
  });

  it('preserves order of other results', () => {
    const r2: DiscoveryResult = { ...RESULT, host: '10.0.0.2', port: 6380 };
    state.finishScan([RESULT, r2]);
    state.updateResult({ ...RESULT, version: '8.0.1' });
    expect(state.getState().results[0].version).toBe('8.0.1');
    expect(state.getState().results[1].host).toBe('10.0.0.2');
  });
});

describe('resetState', () => {
  it('returns to idle', () => {
    state.finishScan([RESULT]);
    state.resetState();
    expect(state.getState().status).toBe('idle');
    expect(state.getState().results).toEqual([]);
  });
});
