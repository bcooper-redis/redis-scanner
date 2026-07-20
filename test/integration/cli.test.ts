import { spawnSync, spawn, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import type { ScanState } from '../../src/web/state';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'dist/cli/index.js');

function rscan(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// Unlike rscan(), does not force utf8 decoding on stdout — needed to check
// --format xlsx output, which is binary and would otherwise get corrupted
// by lossy UTF-8 decoding before the test ever sees the bytes.
function rscanBuffer(...args: string[]): { stdout: Buffer; stderr: string; status: number | null } {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT });
  return {
    stdout: r.stdout ?? Buffer.alloc(0),
    stderr: (r.stderr ?? Buffer.alloc(0)).toString('utf8'),
    status: r.status,
  };
}

async function waitForServer(url: string, maxMs: number): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not become ready within ${maxMs}ms`);
}

const REDIS_8_PORT = process.env.REDIS_8_PORT ?? '6379';
const VALKEY_PORT = process.env.VALKEY_PORT ?? '6380';
const REDIS_AUTH_PORT = process.env.REDIS_AUTH_PORT ?? null;
const REDIS_AUTH_PASSWORD = process.env.REDIS_AUTH_PASSWORD ?? 'testpassword';
const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

let tmpFiles: string[] = [];
function writeTempCsv(content: string): string {
  const file = path.join(
    os.tmpdir(),
    `rscan-credential-test-${Date.now()}-${Math.random().toString(36).slice(2)}.csv`,
  );
  fs.writeFileSync(file, content);
  tmpFiles.push(file);
  return file;
}

function writeTempIni(content: string): string {
  const file = path.join(
    os.tmpdir(),
    `rscan-credential-test-${Date.now()}-${Math.random().toString(36).slice(2)}.ini`,
  );
  fs.writeFileSync(file, content);
  tmpFiles.push(file);
  return file;
}

describe('rscan CLI', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
  }, 30000);

  afterEach(() => {
    for (const file of tmpFiles) fs.rmSync(file, { force: true });
    tmpFiles = [];
  });

  describe('rscan --help', () => {
    it('lists scan and serve subcommands', () => {
      const { stdout, status } = rscan('--help');
      expect(status).toBe(0);
      expect(stdout).toContain('scan');
      expect(stdout).toContain('serve');
    });
  });

  describe('rscan scan --help', () => {
    it('shows scan options', () => {
      const { stdout, status } = rscan('scan', '--help');
      expect(status).toBe(0);
      expect(stdout).toContain('--cidr');
      expect(stdout).toContain('--port');
      expect(stdout).toContain('--tls');
      expect(stdout).toContain('--json');
    });
  });

  describe('rscan scan — table output', () => {
    it('finds Redis 8.x and prints a table', () => {
      const { stdout, status } = rscan('scan', '-c', '127.0.0.1/32', '-p', REDIS_8_PORT);
      expect(status).toBe(0);
      expect(stdout).toContain('redis OSS');
      expect(stdout).toContain('127.0.0.1');
      expect(stdout).toContain(REDIS_8_PORT);
      expect(stdout).toContain('open');
    });

    it('finds Valkey and shows product name', () => {
      const { stdout, status } = rscan('scan', '-c', '127.0.0.1/32', '-p', VALKEY_PORT);
      expect(status).toBe(0);
      expect(stdout).toContain('valkey');
    });

    it('accepts a hostname target and resolves it before scanning', () => {
      const { stdout, status } = rscan('scan', '-c', 'localhost', '-p', REDIS_8_PORT);
      expect(status).toBe(0);
      expect(stdout).toContain('redis OSS');
      expect(stdout).toContain('127.0.0.1');
    });

    it('outputs "No Redis instances found." when port is closed', () => {
      const { stdout, status } = rscan('scan', '-c', '127.0.0.1/32', '-p', '19999');
      expect(status).toBe(0);
      expect(stdout).toContain('No Redis instances found.');
    });

    it('scans both ports together and finds two instances', () => {
      const { stdout } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        `${REDIS_8_PORT},${VALKEY_PORT}`,
      );
      expect(stdout).toContain('redis OSS');
      expect(stdout).toContain('valkey');
    });
  });

  describe('rscan scan --json', () => {
    it('returns valid JSON array', () => {
      const { stdout, status } = rscan('scan', '-c', '127.0.0.1/32', '-p', REDIS_8_PORT, '--json');
      expect(status).toBe(0);
      const results = JSON.parse(stdout);
      expect(Array.isArray(results)).toBe(true);
      expect(results).toHaveLength(1);
    });

    it('JSON result has expected shape', () => {
      const { stdout } = rscan('scan', '-c', '127.0.0.1/32', '-p', REDIS_8_PORT, '--json');
      const [r] = JSON.parse(stdout);
      expect(r.host).toBe('127.0.0.1');
      expect(r.port).toBe(parseInt(REDIS_8_PORT, 10));
      expect(r.product).toBe('redis');
      expect(r.version).toMatch(/^8\./);
      expect(r.anonymousStatus).toBe('open');
      expect(r.inventory).not.toBeNull();
      expect(r.inventory.role).toBe('master');
    });

    it('JSON is empty array for closed port', () => {
      const { stdout } = rscan('scan', '-c', '127.0.0.1/32', '-p', '19999', '--json');
      expect(JSON.parse(stdout)).toEqual([]);
    });
  });

  describe('rscan scan --format', () => {
    it('writes CSV with a header row and the discovered host', () => {
      const { stdout, status } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--format',
        'csv',
      );
      expect(status).toBe(0);
      expect(stdout).toContain('Host,Port');
      expect(stdout).toContain('127.0.0.1');
    });

    it('writes an osstats-compatible INI section for the discovered host', () => {
      const { stdout, status } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--format',
        'ini',
      );
      expect(status).toBe(0);
      expect(stdout).toContain(`[127.0.0.1:${REDIS_8_PORT}]`);
      expect(stdout).toContain('username    = ');
    });

    it('writes binary XLSX (zip-format) bytes to stdout', () => {
      const { stdout, status } = rscanBuffer(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--format',
        'xlsx',
      );
      expect(status).toBe(0);
      expect(stdout.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
    });

    it('still supports --json as a shorthand for --format json', () => {
      const { stdout, status } = rscan('scan', '-c', '127.0.0.1/32', '-p', REDIS_8_PORT, '--json');
      expect(status).toBe(0);
      expect(JSON.parse(stdout)).toHaveLength(1);
    });

    it('lets an explicit --format win when --json is also given', () => {
      const { stdout, status } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--json',
        '--format',
        'csv',
      );
      expect(status).toBe(0);
      expect(stdout).toContain('Host,Port');
      expect(() => JSON.parse(stdout)).toThrow();
    });

    it('exits 1 on an unrecognized --format value', () => {
      const { stderr, status } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--format',
        'yaml',
      );
      expect(status).toBe(1);
      expect(stderr).toContain('invalid --format "yaml"');
    });
  });

  describe('rscan scan — error handling', () => {
    it('exits 1 for invalid CIDR', () => {
      const { status, stderr } = rscan('scan', '-c', 'notacidr', '-p', '6379');
      expect(status).toBe(1);
      expect(stderr).toBeTruthy();
    });

    it('exits 1 for invalid port', () => {
      const { status, stderr } = rscan('scan', '-c', '127.0.0.1/32', '-p', '99999');
      expect(status).toBe(1);
      expect(stderr).toContain('Error');
    });

    it('exits 1 when --username given without --password', () => {
      const { status, stderr } = rscan(
        'scan',
        '-c',
        '127.0.0.1/32',
        '-p',
        REDIS_8_PORT,
        '--username',
        'alice',
      );
      expect(status).toBe(1);
      expect(stderr).toContain('--username requires --password');
    });

    it('exits 1 for a CIDR range that is too large to scan', () => {
      const { status, stderr } = rscan('scan', '-c', '0.0.0.0/8', '-p', '6379');
      expect(status).toBe(1);
      expect(stderr).toContain('too large');
    });

    it('exits 1 for a scan whose host×port total is over the large-scan threshold', () => {
      const { status, stderr } = rscan('scan', '-c', '192.168.1.0/32', '-p', '1-10000');
      expect(status).toBe(1);
      expect(stderr).toContain('estimated 10,000');
      expect(stderr).toContain('--force');
    });

    it('proceeds past the large-scan threshold with --force', () => {
      const { status, stderr } = rscan(
        'scan',
        '-c',
        '192.168.1.0/32',
        '-p',
        '1-10000',
        '--force',
        '-t',
        '100',
        '--concurrency',
        '1000',
      );
      expect(status).toBe(0);
      expect(stderr).not.toContain('estimated');
    }, 15000);
  });

  describe('rscan credential-scan --help', () => {
    it('shows credential-scan options', () => {
      const { stdout, status } = rscan('credential-scan', '--help');
      expect(status).toBe(0);
      expect(stdout).toContain('--file');
      expect(stdout).toContain('.ini');
      expect(stdout).toContain('--tls');
      expect(stdout).toContain('--json');
    });
  });

  describe('rscan credential-scan', () => {
    it('finds Redis 8.x from a CSV with a blank username/password (no auth attempted)', () => {
      const file = writeTempCsv(`host,port,username,password\n127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stdout, status } = rscan('credential-scan', '-f', file, '--json');
      expect(status).toBe(0);
      const [r] = JSON.parse(stdout);
      expect(r.host).toBe('127.0.0.1');
      expect(r.port).toBe(parseInt(REDIS_8_PORT, 10));
      expect(r.product).toBe('redis');
      expect(r.authenticatedStatus).toBe('not_attempted');
    });

    it('table output looks like a normal scan table', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stdout, status } = rscan('credential-scan', '-f', file);
      expect(status).toBe(0);
      expect(stdout).toContain('redis OSS');
      expect(stdout).toContain('127.0.0.1');
      expect(stdout).toContain(REDIS_8_PORT);
    });

    it('scans multiple CSV rows in one pass', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n127.0.0.1,${VALKEY_PORT},,\n`);
      const { stdout } = rscan('credential-scan', '-f', file, '--json');
      const results = JSON.parse(stdout);
      expect(results).toHaveLength(2);
      expect(results.some((r: { product: string }) => r.product === 'redis')).toBe(true);
      expect(results.some((r: { product: string }) => r.product === 'valkey')).toBe(true);
    });

    it('exits 1 when --file is omitted', () => {
      const { status, stderr } = rscan('credential-scan');
      expect(status).toBe(1);
      expect(stderr).toContain('--file');
    });

    it('exits 1 when the file does not exist', () => {
      const { status, stderr } = rscan('credential-scan', '-f', '/nonexistent/path.csv');
      expect(status).toBe(1);
      expect(stderr).toContain('could not read');
    });

    it('exits 1 when the CSV has no valid rows, and never echoes password content in the error', () => {
      const file = writeTempCsv('host,port,username,password\n,6379,someuser,supersecretpw\n');
      const { status, stderr } = rscan('credential-scan', '-f', file);
      expect(status).toBe(1);
      expect(stderr).toContain('no valid targets');
      expect(stderr).not.toContain('supersecretpw');
    });

    it('warns about (but does not fail on) a malformed row alongside a valid one', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n,6380,,\n`);
      const { stdout, stderr, status } = rscan('credential-scan', '-f', file, '--json');
      expect(status).toBe(0);
      expect(stderr).toContain('missing host');
      expect(JSON.parse(stdout)).toHaveLength(1);
    });

    it('exits 1 for a file with more targets than the large-scan threshold', () => {
      const rows = ['host,port,username,password'];
      for (let i = 0; i < 5001; i++) rows.push(`10.0.${Math.floor(i / 256)},${6379 + (i % 256)},,`);
      const file = writeTempCsv(rows.join('\n'));
      const { status, stderr } = rscan('credential-scan', '-f', file);
      expect(status).toBe(1);
      expect(stderr).toContain('estimated 5,001');
      expect(stderr).toContain('--force');
    });

    it('proceeds past the large-scan threshold with --force', () => {
      const rows = ['host,port,username,password'];
      for (let i = 0; i < 5001; i++) rows.push(`127.0.0.1,${20000 + i},,`);
      const file = writeTempCsv(rows.join('\n'));
      const { status, stderr } = rscan(
        'credential-scan',
        '-f',
        file,
        '--force',
        '-t',
        '100',
        '--concurrency',
        '1000',
      );
      expect(status).toBe(0);
      expect(stderr).not.toContain('estimated');
    }, 15000);

    it('finds Redis 8.x from an .ini file, chosen by extension instead of --file needing a flag', () => {
      const file = writeTempIni(
        `[127.0.0.1:${REDIS_8_PORT}]\nhost = 127.0.0.1\nport = ${REDIS_8_PORT}\nusername =\npassword =\n`,
      );
      const { stdout, status } = rscan('credential-scan', '-f', file, '--json');
      expect(status).toBe(0);
      const [r] = JSON.parse(stdout);
      expect(r.host).toBe('127.0.0.1');
      expect(r.port).toBe(parseInt(REDIS_8_PORT, 10));
      expect(r.product).toBe('redis');
      expect(r.authenticatedStatus).toBe('not_attempted');
    });

    it('parses an .ini file shaped exactly like Export INI output, including comments and unused fields', () => {
      const file = writeTempIni(
        '; Generated by Redis Discovery from scan results.\n' +
          '; Fill in username/password (and ca_cert/client_cert/client_key for mTLS)\n' +
          '; before running osstats against these targets.\n\n' +
          `[127.0.0.1:${REDIS_8_PORT}]\n` +
          'host        = 127.0.0.1\n' +
          `port        = ${REDIS_8_PORT}\n` +
          'tls         = false\n' +
          '; Username in case ACL access in enabled\n' +
          'username    = \n' +
          '; Password that applies either in db or user (ACL)\n' +
          'password    = \n' +
          '; ca_cert     = /path/to/ca.crt\n' +
          '; client_cert = /path/to/client.crt\n' +
          '; client_key  = /path/to/client.key\n',
      );
      const { stdout, status } = rscan('credential-scan', '-f', file, '--json');
      expect(status).toBe(0);
      const [r] = JSON.parse(stdout);
      expect(r.host).toBe('127.0.0.1');
      expect(r.product).toBe('redis');
    });

    it('exits 1 when the .ini file has no valid sections, and never echoes password content in the error', () => {
      const file = writeTempIni(
        '[a]\nport = 6379\nusername = someuser\npassword = supersecretpw\n',
      );
      const { status, stderr } = rscan('credential-scan', '-f', file);
      expect(status).toBe(1);
      expect(stderr).toContain('no valid targets');
      expect(stderr).toContain('INI');
      expect(stderr).not.toContain('supersecretpw');
    });

    describeIf(REDIS_AUTH_PORT !== null)('against a real auth-required host', () => {
      it('authenticates with the correct per-target password', () => {
        const file = writeTempCsv(`127.0.0.1,${REDIS_AUTH_PORT},,${REDIS_AUTH_PASSWORD}\n`);
        const { stdout, status } = rscan('credential-scan', '-f', file, '--json');
        expect(status).toBe(0);
        const [r] = JSON.parse(stdout);
        expect(r.authenticatedStatus).toBe('authenticated');
      });

      it('reports auth_failed for the wrong per-target password', () => {
        const file = writeTempCsv(`127.0.0.1,${REDIS_AUTH_PORT},,definitely-wrong\n`);
        const { stdout, status } = rscan('credential-scan', '-f', file, '--json');
        expect(status).toBe(0);
        const [r] = JSON.parse(stdout);
        expect(r.authenticatedStatus).toBe('auth_failed');
      });
    });
  });

  describe('rscan credential-scan --format', () => {
    it('writes CSV with a header row and the discovered host', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stdout, status } = rscan('credential-scan', '-f', file, '--format', 'csv');
      expect(status).toBe(0);
      expect(stdout).toContain('Host,Port');
      expect(stdout).toContain('127.0.0.1');
    });

    it('writes an osstats-compatible INI section for the discovered host', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stdout, status } = rscan('credential-scan', '-f', file, '--format', 'ini');
      expect(status).toBe(0);
      expect(stdout).toContain(`[127.0.0.1:${REDIS_8_PORT}]`);
    });

    it('writes binary XLSX (zip-format) bytes to stdout', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stdout, status } = rscanBuffer('credential-scan', '-f', file, '--format', 'xlsx');
      expect(status).toBe(0);
      expect(stdout.subarray(0, 4).toString('latin1')).toBe('PK\x03\x04');
    });

    it('exits 1 on an unrecognized --format value', () => {
      const file = writeTempCsv(`127.0.0.1,${REDIS_8_PORT},,\n`);
      const { stderr, status } = rscan('credential-scan', '-f', file, '--format', 'yaml');
      expect(status).toBe(1);
      expect(stderr).toContain('invalid --format "yaml"');
    });
  });

  describe('rscan serve', () => {
    it('starts the HTTP server and responds on GET /api/results', async () => {
      const port = 34599;
      const child = spawn('node', [CLI, 'serve', '--port', String(port), '--host', '127.0.0.1'], {
        cwd: ROOT,
        stdio: 'pipe',
      });

      try {
        await waitForServer(`http://127.0.0.1:${port}/api/results`, 5000);
        const res = await fetch(`http://127.0.0.1:${port}/api/results`);
        expect(res.status).toBe(200);
        const body = (await res.json()) as ScanState;
        expect(body.status).toBe('idle');

        // Confirms the built dist/ output includes the copied static UI
        // assets, including the vendored htmx.min.js (only present after a
        // build — not part of src/web/public).
        const dashboard = await fetch(`http://127.0.0.1:${port}/`);
        expect(dashboard.status).toBe(200);
        expect(await dashboard.text()).toContain('New scan');

        const htmx = await fetch(`http://127.0.0.1:${port}/htmx.min.js`);
        expect(htmx.status).toBe(200);
      } finally {
        await new Promise<void>((resolve) => {
          child.once('exit', () => resolve());
          child.kill();
        });
      }
    }, 10000);
  });
});
