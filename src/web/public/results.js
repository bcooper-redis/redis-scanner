(function () {
  const statusPill = document.getElementById('status-pill');
  const statusDetail = document.getElementById('status-detail');
  const elapsedTime = document.getElementById('elapsed-time');
  const errorBanner = document.getElementById('error-banner');
  const tbody = document.getElementById('results-body');
  const table = document.getElementById('results-table');
  const emptyState = document.getElementById('empty-state');
  const targetsBanner = document.getElementById('targets-banner');
  const targetsList = document.getElementById('targets-list');
  const targetsAutoBadge = document.getElementById('targets-auto-badge');
  const duplicateBanner = document.getElementById('duplicate-banner');
  const duplicateBannerText = document.getElementById('duplicate-banner-text');
  const excludeDuplicatesCheckbox = document.getElementById('exclude-duplicates-checkbox');
  const exportCsvLink = document.getElementById('export-csv-link');
  const exportIniLink = document.getElementById('export-ini-link');
  const exportXlsxLink = document.getElementById('export-xlsx-link');
  const pauseResumeBtn = document.getElementById('pause-resume-btn');
  const stopBtn = document.getElementById('stop-btn');
  const restartBtn = document.getElementById('restart-btn');

  const authDialog = document.getElementById('auth-dialog');
  const authForm = document.getElementById('auth-form');
  const authTarget = document.getElementById('auth-target');
  const authUsername = document.getElementById('auth-username');
  const authPassword = document.getElementById('auth-password');
  const authDialogError = document.getElementById('auth-dialog-error');
  const authSubmitBtn = authForm.querySelector('button[type="submit"]');
  let currentAuthTarget = null;

  // Stored on window, not a module-local variable: hx-boost re-executes this
  // whole script on every boosted nav swap (results.js -> Dashboard -> back
  // to Results), which would otherwise create a new, unreachable pollTimer
  // closure each time while the previous execution's setTimeout chain keeps
  // firing forever in the background. Keying off window lets each new
  // execution find and cancel the prior one's pending timer.
  function clearPollTimer() {
    if (window.__rscanPollTimer) {
      clearTimeout(window.__rscanPollTimer);
      window.__rscanPollTimer = null;
    }
  }
  clearPollTimer();

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  function clearError() {
    errorBanner.classList.remove('visible');
    errorBanner.textContent = '';
  }

  // Mirrors src/types/index.ts's productDisplay so the web UI and CLI agree.
  function productDisplay(product) {
    return product === 'redis' ? 'redis OSS' : product;
  }

  // Mirrors src/types/index.ts's findRunIdDuplicates so the web UI and CLI
  // agree on what counts as "the same database reachable through more than
  // one endpoint" (e.g. Redis Enterprise's proxy answering on every node).
  function findRunIdDuplicates(results) {
    const byRunId = new Map();
    for (const r of results) {
      const runId = r.inventory && r.inventory.runId;
      if (!runId) continue;
      const group = byRunId.get(runId);
      if (group) group.push(r);
      else byRunId.set(runId, [r]);
    }
    return Array.from(byRunId.values()).filter((group) => group.length > 1);
  }

  // Mirrors src/types/index.ts's dedupeByRunId — keeps only the first
  // occurrence of each run_id, so the same database found at N endpoints is
  // shown (and exported) once instead of N times.
  function dedupeByRunId(results) {
    const seenRunIds = new Set();
    return results.filter((r) => {
      const runId = r.inventory && r.inventory.runId;
      if (!runId) return true;
      if (seenRunIds.has(runId)) return false;
      seenRunIds.add(runId);
      return true;
    });
  }

  // Maps "host:port" -> the OTHER host:port strings sharing its run_id, for
  // every result that's part of a duplicate group.
  function buildDuplicateEndpoints(duplicateGroups) {
    const map = new Map();
    for (const group of duplicateGroups) {
      for (const r of group) {
        const others = group.filter((g) => g !== r).map((g) => `${g.host}:${g.port}`);
        map.set(`${r.host}:${r.port}`, others);
      }
    }
    return map;
  }

  function shortRunId(runId) {
    if (!runId) return '—';
    return runId.length > 12 ? `${runId.slice(0, 12)}…` : runId;
  }

  function formatReplicatingFrom(replication) {
    if (!replication || !replication.masterHost) return '—';
    const status = replication.masterLinkStatus ? ` (${replication.masterLinkStatus})` : '';
    return `${replication.masterHost}:${replication.masterPort}${status}`;
  }

  // Mirrors src/cli/format.ts's authDisplay so the web UI and CLI agree.
  function authDisplay(r) {
    if (r.anonymousStatus === 'open') {
      return r.authenticatedStatus === 'authenticated' ? 'authed' : 'open';
    }
    if (r.anonymousStatus === 'auth_required') {
      if (r.authenticatedStatus === 'authenticated') return 'authed';
      if (r.authenticatedStatus === 'auth_failed') return 'wrong pw';
      return 'required';
    }
    return 'error';
  }

  function authBadgeClass(r) {
    if (r.anonymousStatus === 'error') return 'error';
    if (r.authenticatedStatus === 'authenticated') return 'authenticated';
    if (r.authenticatedStatus === 'auth_failed') return 'auth_failed';
    if (r.anonymousStatus === 'auth_required') return 'auth_required';
    return 'open';
  }

  function formatElapsed(ms) {
    if (ms == null) return '';
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const sec = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h > 0 ? `Elapsed ${h}:${pad(m)}:${pad(sec)}` : `Elapsed ${m}:${pad(sec)}`;
  }

  function formatUptime(seconds) {
    if (seconds == null) return '—';
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m`;
    return `${seconds}s`;
  }

  function formatBytes(bytes) {
    if (bytes == null) return '—';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024;
      unit++;
    }
    return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
  }

  // maxMemoryBytes null means "no limit" (see parseMemory in src/probe/info.ts)
  // — distinct from usedMemoryBytes null, which means "unknown".
  function formatMemory(memory) {
    const max = memory.maxMemoryBytes != null ? formatBytes(memory.maxMemoryBytes) : 'no limit';
    return `${formatBytes(memory.usedMemoryBytes)} / ${max}`;
  }

  function totalKeys(inv) {
    return inv.keyspace.reduce((sum, db) => sum + db.keys, 0);
  }

  function formatClusterInfo(clusterInfo) {
    if (!clusterInfo) return '—';
    return `${clusterInfo.state ?? 'unknown'} (${clusterInfo.slotsAssigned}/16384)`;
  }

  // Read from the TLS handshake itself, so this is populated even when auth
  // is required and the rest of the row's inventory cells are all "—".
  function certBadgeInfo(cert) {
    if (cert.trusted) return { text: 'CA-issued', className: 'trusted' };
    if (cert.selfSigned) return { text: 'self-signed', className: 'self-signed' };
    return { text: 'untrusted', className: 'self-signed' };
  }

  // Built with createElement/textContent (never innerHTML) so INFO fields
  // like version/os — which come verbatim from the scanned host and are not
  // trustworthy — can never be interpreted as markup.
  function renderRow(r, duplicateEndpoints) {
    const tr = document.createElement('tr');

    function cell(text) {
      const td = document.createElement('td');
      td.textContent = text;
      tr.appendChild(td);
    }

    cell(r.host);
    cell(String(r.port));
    cell(productDisplay(r.product));
    cell(r.version ?? '—');
    cell(r.tls ? 'yes' : 'no');

    const authTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = `badge ${authBadgeClass(r)}`;
    badge.textContent = authDisplay(r);
    authTd.appendChild(badge);
    tr.appendChild(authTd);

    const inv = r.inventory;
    cell(inv ? inv.role : '—');
    cell(inv ? inv.mode : '—');
    cell(inv ? formatClusterInfo(inv.clusterInfo) : '—');
    cell(inv ? String(inv.replication.connectedReplicas.length) : '—');
    cell(inv ? formatReplicatingFrom(inv.replication) : '—');
    cell(inv ? formatMemory(inv.memory) : '—');
    cell(inv ? String(totalKeys(inv)) : '—');
    cell(inv && inv.modules.length > 0 ? inv.modules.map((m) => m.name).join(', ') : '—');
    cell(inv ? inv.os : '—');
    cell(inv ? formatUptime(inv.uptimeSeconds) : '—');
    cell(`${r.latency}ms`);

    const runIdTd = document.createElement('td');
    const runIdSpan = document.createElement('span');
    runIdSpan.className = 'run-id';
    runIdSpan.textContent = shortRunId(inv ? inv.runId : null);
    runIdTd.appendChild(runIdSpan);
    const others = duplicateEndpoints.get(`${r.host}:${r.port}`);
    if (others && others.length > 0) {
      const dupBadge = document.createElement('span');
      dupBadge.className = 'badge duplicate';
      dupBadge.textContent = '⚠ dup';
      dupBadge.title = `Same Run ID also seen at ${others.join(', ')} — likely the same database`;
      runIdTd.appendChild(document.createTextNode(' '));
      runIdTd.appendChild(dupBadge);
    }
    tr.appendChild(runIdTd);

    const certTd = document.createElement('td');
    if (r.tlsCertificate) {
      const subjectSpan = document.createElement('span');
      subjectSpan.textContent = r.tlsCertificate.subject ?? '(no subject)';
      certTd.appendChild(subjectSpan);
      const info = certBadgeInfo(r.tlsCertificate);
      const certBadge = document.createElement('span');
      certBadge.className = `badge ${info.className}`;
      certBadge.textContent = info.text;
      certTd.appendChild(document.createTextNode(' '));
      certTd.appendChild(certBadge);
    } else {
      certTd.textContent = '—';
    }
    tr.appendChild(certTd);

    cell(r.tlsCertificate?.validTo ?? '—');

    const actionTd = document.createElement('td');
    const authBtn = document.createElement('button');
    authBtn.type = 'button';
    authBtn.className = 'secondary';
    authBtn.textContent = 'Authenticate';
    authBtn.addEventListener('click', () => openAuthDialog(r.host, r.port));
    actionTd.appendChild(authBtn);
    tr.appendChild(actionTd);

    return tr;
  }

  function renderTargetsBanner(state) {
    if (!state.targets || state.targets.length === 0) {
      targetsBanner.style.display = 'none';
      return;
    }
    targetsBanner.style.display = '';
    targetsList.innerHTML = '';
    for (const target of state.targets) {
      const chip = document.createElement('span');
      chip.className = 'target-chip';
      chip.textContent = target;
      targetsList.appendChild(chip);
    }
    targetsAutoBadge.style.display = state.autoDetected ? '' : 'none';
  }

  // hiddenCount is only meaningful (and only used) when the checkbox is
  // checked — it's how many rows dedupeByRunId removed from view/exports.
  function renderDuplicateBanner(duplicateGroups, hiddenCount) {
    duplicateBannerText.innerHTML = '';
    if (duplicateGroups.length === 0) {
      duplicateBanner.classList.remove('visible');
      return;
    }
    duplicateBanner.classList.add('visible');
    duplicateBanner.classList.toggle('info', excludeDuplicatesCheckbox.checked);

    const strong = document.createElement('strong');
    const note = document.createElement('span');

    if (excludeDuplicatesCheckbox.checked) {
      strong.textContent = `${hiddenCount} duplicate result${hiddenCount === 1 ? '' : 's'} hidden. `;
      note.textContent = 'Uncheck below to see every endpoint each database was found at.';
    } else {
      const groupWord = duplicateGroups.length === 1 ? 'group' : 'groups';
      strong.textContent = `⚠ ${duplicateGroups.length} ${groupWord} of results share the same Run ID. `;
      note.textContent =
        'That means the same database is reachable through more than one endpoint ' +
        '(common with Redis Enterprise’s proxy layer) — see the Run ID column below.';
    }
    duplicateBannerText.appendChild(strong);
    duplicateBannerText.appendChild(note);
  }

  function updateExportLinks() {
    const suffix = excludeDuplicatesCheckbox.checked ? '?excludeDuplicates=true' : '';
    exportCsvLink.href = `/api/export/csv${suffix}`;
    exportIniLink.href = `/api/export/ini${suffix}`;
    exportXlsxLink.href = `/api/export/xlsx${suffix}`;
  }

  function renderControlButtons(state) {
    const scanning = state.status === 'scanning';
    const paused = state.status === 'paused';
    // restartable is false after a Credential Scan — its per-target
    // passwords are never kept around, so there's nothing to replay.
    const canRestart = state.restartable && ['done', 'error', 'stopped'].includes(state.status);

    pauseResumeBtn.style.display = scanning || paused ? '' : 'none';
    pauseResumeBtn.textContent = paused ? 'Resume' : 'Pause';
    pauseResumeBtn.disabled = false;

    stopBtn.style.display = scanning || paused ? '' : 'none';
    stopBtn.disabled = false;

    restartBtn.style.display = canRestart ? '' : 'none';
    restartBtn.disabled = false;
  }

  // Re-set on every fetch; the checkbox's own change handler re-renders from
  // this without a server round-trip, since hiding duplicates is a pure
  // view/export filter, not something the server needs to know about.
  let lastState = null;

  function render(state) {
    lastState = state;
    renderTargetsBanner(state);
    renderControlButtons(state);
    updateExportLinks();

    const duplicateGroups = findRunIdDuplicates(state.results);
    const visibleResults = excludeDuplicatesCheckbox.checked
      ? dedupeByRunId(state.results)
      : state.results;
    const hiddenCount = state.results.length - visibleResults.length;
    renderDuplicateBanner(duplicateGroups, hiddenCount);

    statusPill.textContent = state.status;
    statusPill.className = `status-pill ${state.status}`;

    if (state.elapsedMs == null) {
      elapsedTime.style.display = 'none';
    } else {
      elapsedTime.style.display = '';
      elapsedTime.textContent = formatElapsed(state.elapsedMs);
    }

    if (state.status === 'scanning' || state.status === 'paused') {
      const prefix = state.status === 'paused' ? 'Paused at ' : 'Scanning ';
      statusDetail.textContent =
        `${prefix}${state.progress.scanDone}/${state.progress.scanTotal} targets · ` +
        `probing ${state.progress.probeDone}/${state.progress.probeTotal} open ports`;
    } else if (state.status === 'done' || state.status === 'stopped') {
      const found = `${visibleResults.length} instance${visibleResults.length === 1 ? '' : 's'} found`;
      statusDetail.textContent =
        hiddenCount > 0 ? `${found} (${hiddenCount} duplicate${hiddenCount === 1 ? '' : 's'} hidden)` : found;
    } else {
      statusDetail.textContent = '';
    }

    if (state.status === 'error') {
      showError(state.error || 'The scan failed.');
    } else {
      clearError();
    }

    tbody.innerHTML = '';

    if (state.status === 'idle') {
      table.style.display = 'none';
      emptyState.style.display = 'block';
      emptyState.innerHTML = '';
      const link = document.createElement('a');
      link.href = '/index.html';
      link.textContent = 'Go to Dashboard to start a scan';
      emptyState.appendChild(link);
      return;
    }

    if (visibleResults.length === 0) {
      table.style.display = 'none';
      emptyState.style.display = 'block';
      if (state.status === 'scanning') {
        emptyState.textContent = 'Scanning…';
      } else if (state.status === 'paused') {
        emptyState.textContent = 'Paused.';
      } else {
        emptyState.textContent = 'No Redis instances found.';
      }
      return;
    }

    table.style.display = '';
    emptyState.style.display = 'none';
    // Built from every result (not just the visible ones), so a row that
    // remains visible after filtering still shows every endpoint — including
    // now-hidden ones — its run_id was actually found at.
    const duplicateEndpoints = buildDuplicateEndpoints(duplicateGroups);
    for (const r of visibleResults) {
      tbody.appendChild(renderRow(r, duplicateEndpoints));
    }
  }

  excludeDuplicatesCheckbox.addEventListener('change', () => {
    if (lastState) render(lastState);
  });

  async function fetchResults() {
    clearPollTimer();
    try {
      const res = await fetch('/api/results');
      const state = await res.json();
      render(state);
      if (state.status === 'scanning' || state.status === 'paused') {
        window.__rscanPollTimer = setTimeout(fetchResults, 1000);
      }
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
    }
  }

  function openAuthDialog(host, port) {
    currentAuthTarget = { host, port };
    authTarget.textContent = `${host}:${port}`;
    authUsername.value = '';
    authPassword.value = '';
    authDialogError.classList.remove('visible');
    authDialogError.textContent = '';
    authSubmitBtn.disabled = false;
    authDialog.showModal();
    authPassword.focus();
  }

  document.getElementById('auth-cancel-btn').addEventListener('click', () => {
    authDialog.close();
  });

  // Fires on every close path — Cancel, Escape, or the programmatic close()
  // after a successful submit — so a typed password never lingers in the
  // closed dialog's DOM.
  authDialog.addEventListener('close', () => {
    authPassword.value = '';
  });

  authForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentAuthTarget) return;
    authSubmitBtn.disabled = true;
    try {
      const res = await fetch('/api/inventory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host: currentAuthTarget.host,
          port: currentAuthTarget.port,
          username: authUsername.value || undefined,
          password: authPassword.value,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        authDialogError.textContent = data.error || `Authentication failed (HTTP ${res.status}).`;
        authDialogError.classList.add('visible');
        authSubmitBtn.disabled = false;
        return;
      }
      authDialog.close();
      await fetchResults();
    } catch {
      authDialogError.textContent = 'Could not reach the server.';
      authDialogError.classList.add('visible');
      authSubmitBtn.disabled = false;
    }
  });

  async function postControlAction(url, button) {
    clearError();
    button.disabled = true;
    try {
      const res = await fetch(url, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || `Request failed (HTTP ${res.status}).`);
        button.disabled = false;
        return;
      }
      await fetchResults();
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
      button.disabled = false;
    }
  }

  pauseResumeBtn.addEventListener('click', () => {
    const action = pauseResumeBtn.textContent.trim() === 'Resume' ? 'resume' : 'pause';
    void postControlAction(`/api/scan/${action}`, pauseResumeBtn);
  });

  stopBtn.addEventListener('click', () => void postControlAction('/api/scan/stop', stopBtn));

  restartBtn.addEventListener('click', () =>
    void postControlAction('/api/scan/restart', restartBtn),
  );

  document.getElementById('refresh-btn').addEventListener('click', () => fetchResults());

  fetchResults();
})();
