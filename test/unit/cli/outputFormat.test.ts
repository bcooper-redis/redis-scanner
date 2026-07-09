import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveFormat, writeFormattedOutput } from '../../../src/cli/outputFormat';
import type { DiscoveryResult } from '../../../src/types';

const OPEN: DiscoveryResult = {
  host: '10.0.0.1',
  port: 6379,
  tls: false,
  product: 'redis',
  version: '8.0.0',
  authRequired: false,
  anonymousStatus: 'open',
  authenticatedStatus: 'not_attempted',
  latency: 3,
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
      usedMemoryBytes: 1048576,
      maxMemoryBytes: null,
      maxMemoryPolicy: null,
      totalSystemMemoryBytes: null,
      usedMemoryPeakBytes: null,
    },
    keyspace: [],
    modules: [],
    clusterInfo: null,
    runId: 'a3f92c1e2b8d4f1a9c7e6d5b4a3f92c1e2b8d4f1',
    connectedClients: null,
  },
  tlsCertificate: null,
};

describe('resolveFormat', () => {
  it('defaults to table when neither --format nor --json is given', () => {
    expect(resolveFormat(undefined, false)).toBe('table');
  });

  it('resolves --json to json when --format is not given', () => {
    expect(resolveFormat(undefined, true)).toBe('json');
  });

  it('passes through an explicit --format value', () => {
    expect(resolveFormat('csv', false)).toBe('csv');
    expect(resolveFormat('ini', false)).toBe('ini');
    expect(resolveFormat('xlsx', false)).toBe('xlsx');
    expect(resolveFormat('table', false)).toBe('table');
    expect(resolveFormat('json', false)).toBe('json');
  });

  it('lets an explicit --format win over --json', () => {
    expect(resolveFormat('csv', true)).toBe('csv');
  });

  it('exits 1 and reports the error on an unrecognized --format value', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    resolveFormat('yaml', false);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('invalid --format "yaml"'));

    exitSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

describe('writeFormattedOutput', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function captureStdout(): {
    write: (format: 'table' | 'json' | 'csv' | 'ini' | 'xlsx') => void;
    output: () => Buffer;
  } {
    const chunks: Buffer[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
      return true;
    });
    return {
      write: (format) => writeFormattedOutput(format, [OPEN]),
      output: () => Buffer.concat(chunks),
    };
  }

  it('writes a table for "table"', () => {
    const { write, output } = captureStdout();
    write('table');
    const text = output().toString('utf8');
    expect(text).toContain('HOST');
    expect(text).toContain('10.0.0.1');
  });

  it('writes valid JSON for "json"', () => {
    const { write, output } = captureStdout();
    write('json');
    const parsed = JSON.parse(output().toString('utf8'));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].host).toBe('10.0.0.1');
  });

  it('writes CSV for "csv"', () => {
    const { write, output } = captureStdout();
    write('csv');
    const text = output().toString('utf8');
    expect(text).toContain('Host,Port');
    expect(text).toContain('10.0.0.1');
  });

  it('writes INI for "ini"', () => {
    const { write, output } = captureStdout();
    write('ini');
    const text = output().toString('utf8');
    expect(text).toContain('[10.0.0.1:6379]');
  });

  it('writes binary XLSX (zip-format) bytes for "xlsx"', () => {
    const { write, output } = captureStdout();
    write('xlsx');
    const bytes = output();
    // ZIP local file header magic bytes — confirms this is a real archive,
    // not text accidentally written for a binary format.
    expect(bytes.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
  });
});
