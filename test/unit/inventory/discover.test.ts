import * as net from 'net';
import { describe, it, expect } from 'vitest';
import { discover } from '../../../src/inventory/discover';

function bulkString(s: string): string {
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
}

/** Extracts each pipelined command's name (first bulk string after a "*N") from a raw buffer. */
function parseCommandNames(data: Buffer): string[] {
  const str = data.toString();
  const names: string[] = [];
  const re = /\*\d+\r\n\$\d+\r\n([^\r\n]+)\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    names.push(m[1].toLowerCase());
  }
  return names;
}

function buildInfo(runId: string): string {
  return (
    `# Server\r\nredis_version:8.0.0\r\nredis_mode:standalone\r\nrun_id:${runId}\r\n` +
    '# Replication\r\nrole:master\r\n# Memory\r\nused_memory:1048576\r\nmaxmemory:0\r\n' +
    'maxmemory_policy:noeviction\r\n'
  );
}

interface MockRedis {
  port: number;
  /** run_id starts as "unset" — call this once the desired grouping is known. */
  setRunId: (id: string) => void;
  close: () => Promise<void>;
}

/**
 * Minimal open (no-auth) mock Redis server. run_id is settable *after* the
 * server is listening, so a test can first see which port the OS assigned
 * and only then decide which servers should share a run_id — port
 * assignment order isn't something a test can otherwise control.
 */
function startMockRedis(): Promise<MockRedis> {
  let runId = 'unset';
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      for (const cmd of parseCommandNames(data)) {
        if (cmd === 'client') socket.write('+OK\r\n');
        else if (cmd === 'ping') socket.write('+PONG\r\n');
        else if (cmd === 'info') socket.write(bulkString(buildInfo(runId)));
        else if (cmd === 'module') socket.write('*0\r\n');
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        setRunId: (id: string) => {
          runId = id;
        },
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on('error', reject);
  });
}

describe('discover — target deduplication', () => {
  it('scans a duplicated CIDR only once, never reporting the same target twice', async () => {
    const mock = await startMockRedis();
    mock.setRunId('same-process-abc');
    const results = await discover({
      cidrs: ['127.0.0.1', '127.0.0.1'], // e.g. the same subnet auto-detected via two interfaces
      ports: [mock.port],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await mock.close();
    expect(results).toHaveLength(1);
  });
});

describe('discover — run_id duplicate grouping', () => {
  it('clusters a run_id duplicate group together even when a different-run_id result sorts in between by port', async () => {
    const mocks = await Promise.all([startMockRedis(), startMockRedis(), startMockRedis()]);
    const byPort = [...mocks].sort((a, b) => a.port - b.port);

    // Deterministic regardless of which actual ports the OS assigned: the
    // lowest- and highest-port servers share a run_id; the one in between
    // (by port — i.e. by plain host/port sort order) does not. If grouping
    // didn't work, plain host/port sort would place that middle result
    // between the two matching ones instead of the two matching ones
    // ending up adjacent.
    byPort[0].setRunId('cluster-run-id');
    byPort[1].setRunId('other-database-run-id');
    byPort[2].setRunId('cluster-run-id');

    const results = await discover({
      cidrs: ['127.0.0.1'],
      ports: byPort.map((m) => m.port),
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await Promise.all(mocks.map((m) => m.close()));

    expect(results).toHaveLength(3);
    const runIdSequence = results.map((r) => r.inventory!.runId);
    const clusterIndices = runIdSequence
      .map((id, i) => (id === 'cluster-run-id' ? i : -1))
      .filter((i) => i !== -1);
    expect(clusterIndices).toHaveLength(2);
    expect(clusterIndices[1] - clusterIndices[0]).toBe(1); // adjacent, nothing in between
  });

  it('leaves non-duplicate results in plain host/port order', async () => {
    const mocks = await Promise.all([startMockRedis(), startMockRedis()]);
    const byPort = [...mocks].sort((a, b) => a.port - b.port);
    byPort[0].setRunId('run-a');
    byPort[1].setRunId('run-b');

    const results = await discover({
      cidrs: ['127.0.0.1'],
      ports: byPort.map((m) => m.port),
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await Promise.all(mocks.map((m) => m.close()));

    expect(results.map((r) => r.port)).toEqual(byPort.map((m) => m.port));
  });
});

describe('discover — large scan guard', () => {
  it('rejects before scanning when total targets (hosts × ports) exceed the threshold', async () => {
    await expect(
      discover({
        cidrs: ['10.0.0.0/24'], // 254 hosts
        ports: Array.from({ length: 30 }, (_, i) => 6000 + i), // 30 ports → 7620 total
        timeoutMs: 1000,
        tls: false,
        tlsSkipVerify: false,
        concurrency: 100,
      }),
    ).rejects.toThrow(/estimated 7,620/);
  });

  it('proceeds when force is true, even above the threshold', async () => {
    const results = await discover({
      cidrs: ['127.0.0.1'],
      ports: Array.from({ length: 5001 }, (_, i) => 20000 + i),
      timeoutMs: 500,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 500,
      force: true,
    });
    expect(results).toEqual([]);
  }, 20000);
});
