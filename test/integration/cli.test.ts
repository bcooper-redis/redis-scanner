import { spawnSync, spawn, execSync } from 'child_process';
import * as path from 'path';
import { describe, it, expect, beforeAll } from 'vitest';
import type { ScanState } from '../../src/web/state';

const ROOT = path.resolve(__dirname, '../..');
const CLI = path.join(ROOT, 'dist/cli/index.js');

function rscan(...args: string[]): { stdout: string; stderr: string; status: number | null } {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', cwd: ROOT });
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
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

describe('rscan CLI', () => {
  beforeAll(() => {
    execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
  }, 30000);

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
