import { Router } from 'express';
import { discover } from '../../inventory/discover';
import { credentialScan } from '../../inventory/credentialScan';
import type { CredentialTarget } from '../../inventory/credentialScan';
import { expandPorts } from '../../scanner/ports';
import { detectLocalCidrs, assertScanSize } from '../../scanner/cidr';
import { assertScanNotTooLarge, estimateScanTargets, LargeScanError } from '../../scanner/scanSize';
import { createScanController } from '../../scanner/control';
import type { AppState } from '../state';
import type { ScanConfig, AuthCredentials } from '../../types';

export const scanRouter = Router();

/**
 * Kick off a discover() run in the background and wire its callbacks to
 * `state`. Each callback is gated on the generation startScan() returns —
 * if a newer scan (or restart) has since started, this run's late-arriving
 * progress/results/completion are silently dropped instead of clobbering it.
 */
function launchScan(
  state: AppState,
  config: ScanConfig,
  targets: string[],
  autoDetected: boolean,
  credentials: AuthCredentials | undefined,
): void {
  const controller = createScanController();
  const generation = state.startScan(targets, autoDetected, config, controller);
  const isCurrent = () => state.getGeneration() === generation;

  void discover(config, {
    credentials,
    controller,
    onScanProgress: (done, total) => {
      if (isCurrent()) state.updateScanProgress(done, total);
    },
    onProbeProgress: (done, total) => {
      if (isCurrent()) state.updateProbeProgress(done, total);
    },
    onResult: (result) => {
      if (isCurrent()) state.updateResult(result);
    },
  })
    .then((results) => {
      if (isCurrent()) state.finishScan(results);
    })
    .catch((e: Error) => {
      if (isCurrent()) state.failScan(e.message);
    });
}

scanRouter.post('/scan', (req, res) => {
  const state = req.app.get('state') as AppState;
  const status = state.getState().status;

  if (status === 'scanning' || status === 'paused') {
    res.status(409).json({ error: 'A scan is already in progress.' });
    return;
  }

  const body = req.body as {
    cidrs?: unknown;
    ports?: unknown;
    timeoutMs?: unknown;
    concurrency?: unknown;
    tls?: unknown;
    tlsSkipVerify?: unknown;
    password?: unknown;
    username?: unknown;
    force?: unknown;
  };
  const force = body.force === true;

  let cidrs: string[];
  let autoDetected = false;
  if (!body.cidrs || (Array.isArray(body.cidrs) && body.cidrs.length === 0)) {
    cidrs = detectLocalCidrs();
    autoDetected = true;
    if (cidrs.length === 0) {
      res.status(400).json({ error: 'No CIDRs provided and none could be auto-detected.' });
      return;
    }
  } else if (!Array.isArray(body.cidrs) || body.cidrs.some((c) => typeof c !== 'string')) {
    res.status(400).json({ error: 'cidrs must be an array of strings.' });
    return;
  } else {
    cidrs = body.cidrs as string[];
  }

  try {
    assertScanSize(cidrs);
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  let ports: number[];
  try {
    const portInput = body.ports ?? '6379';
    ports = expandPorts(Array.isArray(portInput) ? (portInput as number[]) : String(portInput));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  try {
    assertScanNotTooLarge(estimateScanTargets(cidrs, ports.length), force);
  } catch (e) {
    if (e instanceof LargeScanError) {
      res
        .status(400)
        .json({ error: e.message, code: 'SCAN_TOO_LARGE', totalTargets: e.totalTargets });
      return;
    }
    throw e;
  }

  const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(1, body.timeoutMs) : 1000;
  const concurrency = typeof body.concurrency === 'number' ? Math.max(1, body.concurrency) : 100;
  const tls = body.tls === true;
  const tlsSkipVerify = body.tlsSkipVerify === true;

  if (typeof body.username === 'string' && typeof body.password !== 'string') {
    res.status(400).json({ error: 'username requires password.' });
    return;
  }

  const credentials =
    typeof body.password === 'string'
      ? {
          password: body.password,
          username: typeof body.username === 'string' ? body.username : undefined,
        }
      : undefined;

  const config: ScanConfig = { cidrs, ports, timeoutMs, concurrency, tls, tlsSkipVerify, force };

  // Runs in background — the caller polls GET /api/results
  launchScan(state, config, cidrs, autoDetected, credentials);

  res.status(202).json({ status: 'scanning' });
});

/**
 * Same background-launch/generation-gating pattern as launchScan(), but for
 * a Credential Scan: config is null (see AppState.startScan) so there's
 * nothing for /scan/restart to replay — each target's credentials only ever
 * exist for the duration of this one call.
 */
function launchCredentialScan(
  state: AppState,
  targets: CredentialTarget[],
  timeoutMs: number,
  concurrency: number,
  tls: boolean,
  tlsSkipVerify: boolean,
  force: boolean,
): void {
  const controller = createScanController();
  const targetLabels = targets.map((t) => `${t.host}:${t.port}`);
  const generation = state.startScan(targetLabels, false, null, controller);
  const isCurrent = () => state.getGeneration() === generation;

  void credentialScan(
    { targets, timeoutMs, concurrency, tls, tlsSkipVerify, force },
    {
      controller,
      onScanProgress: (done, total) => {
        if (isCurrent()) state.updateScanProgress(done, total);
      },
      onProbeProgress: (done, total) => {
        if (isCurrent()) state.updateProbeProgress(done, total);
      },
      onResult: (result) => {
        if (isCurrent()) state.updateResult(result);
      },
    },
  )
    .then((results) => {
      if (isCurrent()) state.finishScan(results);
    })
    .catch((e: Error) => {
      if (isCurrent()) state.failScan(e.message);
    });
}

scanRouter.post('/credential-scan', (req, res) => {
  const state = req.app.get('state') as AppState;
  const status = state.getState().status;

  if (status === 'scanning' || status === 'paused') {
    res.status(409).json({ error: 'A scan is already in progress.' });
    return;
  }

  const body = req.body as {
    targets?: unknown;
    timeoutMs?: unknown;
    concurrency?: unknown;
    tls?: unknown;
    tlsSkipVerify?: unknown;
    force?: unknown;
  };
  const force = body.force === true;

  if (!Array.isArray(body.targets) || body.targets.length === 0) {
    res.status(400).json({ error: 'targets must be a non-empty array.' });
    return;
  }

  const targets: CredentialTarget[] = [];
  for (let i = 0; i < body.targets.length; i++) {
    const row = body.targets[i] as {
      host?: unknown;
      port?: unknown;
      username?: unknown;
      password?: unknown;
    };
    const host = row?.host;
    const port = row?.port;
    if (
      typeof host !== 'string' ||
      !host ||
      typeof port !== 'number' ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      res
        .status(400)
        .json({ error: `targets[${i}] must have a non-empty host and a port between 1-65535.` });
      return;
    }
    targets.push({
      host,
      port,
      username: typeof row.username === 'string' && row.username ? row.username : undefined,
      password: typeof row.password === 'string' && row.password ? row.password : undefined,
    });
  }

  try {
    // Degenerates to "reject more than 65,536 targets" here — every entry is
    // already a bare host, not a CIDR, so this just reuses the same ceiling
    // rather than needing a second, parallel size cap.
    assertScanSize(targets.map((t) => t.host));
  } catch (e) {
    res.status(400).json({ error: (e as Error).message });
    return;
  }

  try {
    assertScanNotTooLarge(targets.length, force);
  } catch (e) {
    if (e instanceof LargeScanError) {
      res
        .status(400)
        .json({ error: e.message, code: 'SCAN_TOO_LARGE', totalTargets: e.totalTargets });
      return;
    }
    throw e;
  }

  const timeoutMs = typeof body.timeoutMs === 'number' ? Math.max(1, body.timeoutMs) : 1000;
  const concurrency = typeof body.concurrency === 'number' ? Math.max(1, body.concurrency) : 100;
  const tls = body.tls === true;
  const tlsSkipVerify = body.tlsSkipVerify === true;

  // Runs in background — the caller polls GET /api/results
  launchCredentialScan(state, targets, timeoutMs, concurrency, tls, tlsSkipVerify, force);

  res.status(202).json({ status: 'scanning' });
});

scanRouter.post('/scan/pause', (req, res) => {
  const state = req.app.get('state') as AppState;
  if (state.getState().status !== 'scanning') {
    res.status(409).json({ error: 'No running scan to pause.' });
    return;
  }
  state.getController()?.pause();
  state.pauseScan();
  res.json(state.getState());
});

scanRouter.post('/scan/resume', (req, res) => {
  const state = req.app.get('state') as AppState;
  if (state.getState().status !== 'paused') {
    res.status(409).json({ error: 'No paused scan to resume.' });
    return;
  }
  state.getController()?.resume();
  state.resumeScan();
  res.json(state.getState());
});

scanRouter.post('/scan/stop', (req, res) => {
  const state = req.app.get('state') as AppState;
  const status = state.getState().status;
  if (status !== 'scanning' && status !== 'paused') {
    res.status(409).json({ error: 'No running or paused scan to stop.' });
    return;
  }
  state.getController()?.stop();
  state.markStopped();
  res.json(state.getState());
});

scanRouter.post('/scan/restart', (req, res) => {
  const state = req.app.get('state') as AppState;
  const current = state.getState();

  if (current.status === 'scanning' || current.status === 'paused') {
    res.status(409).json({ error: 'Stop the current scan before restarting.' });
    return;
  }

  const lastConfig = state.getLastConfig();
  if (!lastConfig) {
    res.status(400).json({ error: 'No previous scan to restart.' });
    return;
  }

  // Credentials are never persisted, so a restarted scan always runs
  // anonymously — re-authenticate per host afterward if needed.
  launchScan(state, lastConfig, current.targets, current.autoDetected, undefined);

  res.status(202).json({ status: 'scanning' });
});

scanRouter.get('/results', (req, res) => {
  const state = req.app.get('state') as AppState;
  res.json(state.getState());
});
