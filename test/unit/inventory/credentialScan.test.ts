import * as net from 'net';
import * as tls from 'tls';
import { describe, it, expect } from 'vitest';
import { credentialScan } from '../../../src/inventory/credentialScan';

function bulkString(s: string): string {
  return `$${Buffer.byteLength(s)}\r\n${s}\r\n`;
}

/** Parses every pipelined RESP command's full argv from a raw buffer. */
function parseAllRespCommands(data: Buffer): string[][] {
  const str = data.toString();
  const commands: string[][] = [];
  const re = /\*(\d+)\r\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const n = parseInt(m[1], 10);
    const args: string[] = [];
    let pos = m.index + m[0].length;
    for (let i = 0; i < n; i++) {
      const lenMatch = /\$(\d+)\r\n/.exec(str.slice(pos));
      if (!lenMatch) break;
      pos += lenMatch.index + lenMatch[0].length;
      const len = parseInt(lenMatch[1], 10);
      args.push(str.slice(pos, pos + len));
      pos += len + 2;
    }
    commands.push(args);
  }
  return commands;
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
  authCommandCount: () => number;
  close: () => Promise<void>;
}

/**
 * A mock Redis that requires `expectedPassword` (null means open, no auth
 * configured at all). Tracks how many AUTH commands it actually received,
 * so a test can prove AUTH was (or wasn't) attempted, not just infer it from
 * the final result.
 */
function startMockRedis(
  expectedPassword: string | null,
  runId = 'mock-run-id',
): Promise<MockRedis> {
  let authed = expectedPassword === null;
  let authCount = 0;
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      for (const args of parseAllRespCommands(data)) {
        const cmd = (args[0] ?? '').toLowerCase();
        if (cmd === 'auth') {
          authCount++;
          const pass = args[args.length - 1];
          if (pass === expectedPassword) {
            authed = true;
            socket.write('+OK\r\n');
          } else {
            socket.write('-WRONGPASS invalid username-password pair or user is disabled.\r\n');
          }
        } else if (cmd === 'client') {
          socket.write('+OK\r\n');
        } else if (cmd === 'ping') {
          socket.write(authed ? '+PONG\r\n' : '-NOAUTH Authentication required.\r\n');
        } else if (cmd === 'info') {
          socket.write(
            authed ? bulkString(buildInfo(runId)) : '-NOAUTH Authentication required.\r\n',
          );
        } else if (cmd === 'module') {
          socket.write(authed ? '*0\r\n' : '-NOAUTH Authentication required.\r\n');
        }
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({
        port,
        authCommandCount: () => authCount,
        close: () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res()))),
      });
    });
    server.on('error', reject);
  });
}

describe('credentialScan — per-target credentials', () => {
  it('resolves each target with its own credentials, independently', async () => {
    const a = await startMockRedis('password-for-a');
    const b = await startMockRedis('password-for-b');

    const results = await credentialScan({
      targets: [
        { host: '127.0.0.1', port: a.port, password: 'password-for-a' },
        { host: '127.0.0.1', port: b.port, password: 'password-for-b' },
      ],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await Promise.all([a.close(), b.close()]);

    const byPort = new Map(results.map((r) => [r.port, r]));
    expect(byPort.get(a.port)?.authenticatedStatus).toBe('authenticated');
    expect(byPort.get(b.port)?.authenticatedStatus).toBe('authenticated');
  });

  it("reports auth_failed for a target whose password doesn't match, without affecting other targets", async () => {
    const correct = await startMockRedis('right-password');
    const wrong = await startMockRedis('right-password');

    const results = await credentialScan({
      targets: [
        { host: '127.0.0.1', port: correct.port, password: 'right-password' },
        { host: '127.0.0.1', port: wrong.port, password: 'totally-wrong' },
      ],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await Promise.all([correct.close(), wrong.close()]);

    const byPort = new Map(results.map((r) => [r.port, r]));
    expect(byPort.get(correct.port)?.authenticatedStatus).toBe('authenticated');
    expect(byPort.get(wrong.port)?.authenticatedStatus).toBe('auth_failed');
  });

  it('never sends AUTH for a target with a blank password', async () => {
    const open = await startMockRedis(null);

    const results = await credentialScan({
      targets: [{ host: '127.0.0.1', port: open.port }],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await open.close();

    expect(open.authCommandCount()).toBe(0);
    expect(results[0].authenticatedStatus).toBe('not_attempted');
    expect(results[0].anonymousStatus).toBe('open');
  });

  it("doesn't attempt AUTH when username is set but password is blank", async () => {
    const open = await startMockRedis(null);

    const results = await credentialScan({
      targets: [{ host: '127.0.0.1', port: open.port, username: 'alice' }],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await open.close();

    expect(open.authCommandCount()).toBe(0);
    expect(results[0].authenticatedStatus).toBe('not_attempted');
  });
});

describe('credentialScan — duplicate targets', () => {
  it('scans a duplicated (host, port) entry only once, keeping the last matching row', async () => {
    const mock = await startMockRedis('second-password');

    const results = await credentialScan({
      targets: [
        { host: '127.0.0.1', port: mock.port, password: 'first-password' },
        { host: '127.0.0.1', port: mock.port, password: 'second-password' },
      ],
      timeoutMs: 1000,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });
    await mock.close();

    expect(results).toHaveLength(1);
    expect(results[0].authenticatedStatus).toBe('authenticated');
    expect(mock.authCommandCount()).toBe(1);
  });
});

describe('credentialScan — progress and results callbacks', () => {
  it('fires onScanProgress, onProbeProgress, and onResult', async () => {
    const mock = await startMockRedis(null);
    const scanTicks: number[] = [];
    const probeTicks: number[] = [];
    const found: string[] = [];

    await credentialScan(
      {
        targets: [{ host: '127.0.0.1', port: mock.port }],
        timeoutMs: 1000,
        tls: false,
        tlsSkipVerify: false,
        concurrency: 10,
      },
      {
        onScanProgress: (done) => scanTicks.push(done),
        onProbeProgress: (done) => probeTicks.push(done),
        onResult: (r) => found.push(`${r.host}:${r.port}`),
      },
    );
    await mock.close();

    expect(scanTicks).toEqual([1]);
    expect(probeTicks).toEqual([1]);
    expect(found).toEqual([`127.0.0.1:${mock.port}`]);
  });
});

describe('credentialScan — unreachable and non-Redis targets', () => {
  it('omits a target with a closed port from the results, without throwing', async () => {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

    const results = await credentialScan({
      targets: [{ host: '127.0.0.1', port, password: 'whatever' }],
      timeoutMs: 500,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 10,
    });

    expect(results).toEqual([]);
  });
});

describe('credentialScan — TLS', () => {
  it('reads the TLS certificate for a target even though its own credentials are wrong', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const fixtures = path.join(__dirname, '../../fixtures/tls');
    const server = tls.createServer(
      {
        key: fs.readFileSync(path.join(fixtures, 'server.key')),
        cert: fs.readFileSync(path.join(fixtures, 'server.crt')),
      },
      (socket) => {
        socket.on('data', (data) => {
          for (const args of parseAllRespCommands(data)) {
            const cmd = (args[0] ?? '').toLowerCase();
            if (cmd === 'auth')
              socket.write('-WRONGPASS invalid username-password pair or user is disabled.\r\n');
            else if (cmd === 'client') socket.write('+OK\r\n');
          }
        });
      },
    );
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as net.AddressInfo;

    const results = await credentialScan({
      targets: [{ host: '127.0.0.1', port, password: 'wrong' }],
      timeoutMs: 2000,
      tls: true,
      tlsSkipVerify: true,
      concurrency: 10,
    });
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

    expect(results[0].authenticatedStatus).toBe('auth_failed');
    expect(results[0].tlsCertificate).not.toBeNull();
    expect(results[0].tlsCertificate!.subject).toBe('localhost');
  });
});

describe('credentialScan — large scan guard', () => {
  it('rejects before scanning when target count exceeds the threshold', async () => {
    const manyTargets = Array.from({ length: 5001 }, (_, i) => ({
      host: '10.0.0.1',
      port: 6379 + i,
    }));
    await expect(
      credentialScan({
        targets: manyTargets,
        timeoutMs: 1000,
        tls: false,
        tlsSkipVerify: false,
        concurrency: 100,
      }),
    ).rejects.toThrow(/estimated 5,001/);
  });

  it('proceeds when force is true, even above the threshold', async () => {
    const manyTargets = Array.from({ length: 5001 }, (_, i) => ({
      host: '127.0.0.1',
      port: 20000 + i,
    }));
    const results = await credentialScan({
      targets: manyTargets,
      timeoutMs: 500,
      tls: false,
      tlsSkipVerify: false,
      concurrency: 500,
      force: true,
    });
    expect(results).toEqual([]);
  }, 20000);
});
