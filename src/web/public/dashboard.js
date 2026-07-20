(function () {
  const form = document.getElementById('scan-form');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');
  const csvUpload = document.getElementById('csv-upload');
  const csvUploadStatus = document.getElementById('csv-upload-status');
  const largeScanDialog = document.getElementById('large-scan-warning-dialog');
  const largeScanText = document.getElementById('large-scan-warning-text');
  const largeScanProceedBtn = document.getElementById('large-scan-proceed-btn');
  const largeScanCancelBtn = document.getElementById('large-scan-cancel-btn');

  const SESSION_KEY = 'rscan.dashboardState';

  function showError(message) {
    errorBanner.textContent = message;
    errorBanner.classList.add('visible');
  }

  function clearError() {
    errorBanner.classList.remove('visible');
    errorBanner.textContent = '';
  }

  // Pre-fill non-sensitive defaults saved on the Settings page. Credentials
  // are never read from or written to storage.
  function applyStoredDefaults() {
    let defaults;
    try {
      defaults = JSON.parse(localStorage.getItem('rscan.scanDefaults') || '{}');
    } catch {
      defaults = {};
    }
    if (defaults.ports) form.ports.value = defaults.ports;
    if (defaults.timeoutMs) form.timeoutMs.value = defaults.timeoutMs;
    if (defaults.concurrency) form.concurrency.value = defaults.concurrency;
    if (defaults.tls) form.tls.checked = true;
    if (defaults.tlsSkipVerify) form.tlsSkipVerify.checked = true;
  }

  // Remembers whatever is currently typed in the form for the lifetime of
  // this browser tab, so navigating to Results and back doesn't lose it.
  // sessionStorage (not localStorage) means this never survives closing the
  // tab/browser — only saved Settings defaults do that. Credentials are
  // never read here, so they can never end up in this snapshot.
  function saveSessionState() {
    const state = {
      cidrs: form.cidrs.value,
      ports: form.ports.value,
      timeoutMs: form.timeoutMs.value,
      concurrency: form.concurrency.value,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state));
  }

  function restoreSessionState() {
    let saved;
    try {
      saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved) return;
    if (typeof saved.cidrs === 'string') form.cidrs.value = saved.cidrs;
    if (typeof saved.ports === 'string') form.ports.value = saved.ports;
    if (typeof saved.timeoutMs === 'string') form.timeoutMs.value = saved.timeoutMs;
    if (typeof saved.concurrency === 'string') form.concurrency.value = saved.concurrency;
    form.tls.checked = Boolean(saved.tls);
    form.tlsSkipVerify.checked = Boolean(saved.tlsSkipVerify);
  }

  applyStoredDefaults();
  restoreSessionState();

  form.addEventListener('input', saveSessionState);
  form.addEventListener('change', saveSessionState);

  function fireInput(el) {
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  // Client-side only — the file is read and parsed in the browser and never
  // uploaded anywhere. It just replaces the Targets field, so everything
  // downstream (submit, sessionStorage, scan-size validation) works exactly
  // as if the targets had been typed by hand.
  csvUpload.addEventListener('change', () => {
    const file = csvUpload.files[0];
    csvUploadStatus.textContent = '';
    csvUploadStatus.classList.remove('error');
    if (!file) return;

    // Strips at most one leading and one trailing quote, independently of
    // each other. A spreadsheet-exported CSV often quotes a whole row as one
    // unit when it contains a comma (e.g. "host,port" typed into a single
    // cell) — naively splitting that row on its embedded comma leaves a
    // stray quote stuck to each half, since neither half has a matching
    // pair on its own. This also handles ordinary one-quote-per-field CSVs
    // the same way, since stripping is applied per cell either way.
    function stripQuotes(cell) {
      let result = cell.trim();
      if (result.startsWith('"')) result = result.slice(1);
      if (result.endsWith('"')) result = result.slice(0, -1);
      return result.trim();
    }

    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result || '')
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(',').map(stripQuotes));

      // Skip an optional header row, e.g. "host,port" or "hostname,ip".
      if (rows.length > 0 && /^(host|hostname|ip|ip ?address|target)s?$/i.test(rows[0][0])) {
        rows.shift();
      }

      // Each row's port travels with its host as "host:port" rather than
      // being pooled into the shared Ports field — otherwise a file with a
      // different port per host would scan every host on every port in the
      // file instead of just its own pairing.
      const targets = new Set();
      let pairedCount = 0;
      for (const [host, port] of rows) {
        if (!host) continue;
        if (port) {
          targets.add(`${host}:${port}`);
          pairedCount++;
        } else {
          targets.add(host);
        }
      }

      csvUpload.value = ''; // lets re-uploading the same filename fire 'change' again

      if (targets.size === 0) {
        csvUploadStatus.textContent = `No targets found in ${file.name}.`;
        csvUploadStatus.classList.add('error');
        return;
      }

      form.cidrs.value = Array.from(targets).join('\n');
      fireInput(form.cidrs);

      csvUploadStatus.textContent =
        `Loaded ${targets.size} target${targets.size === 1 ? '' : 's'} from ${file.name}` +
        (pairedCount > 0 ? ` (${pairedCount} with an explicit port)` : '');
    };
    reader.onerror = () => {
      csvUpload.value = '';
      csvUploadStatus.textContent = `Could not read ${file.name}.`;
      csvUploadStatus.classList.add('error');
    };
    reader.readAsText(file);
  });

  // Submits body to /api/scan. On a SCAN_TOO_LARGE 400, shows a confirm
  // dialog instead of the plain error banner; clicking Proceed re-calls this
  // with force:true merged in, so the large-scan check only ever needs to
  // run once more, server-side, rather than duplicating its host×port math
  // here in the browser.
  async function submitScan(body) {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting…';

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Scan';
        if (data.code === 'SCAN_TOO_LARGE') {
          largeScanText.textContent =
            `This scan targets an estimated ${data.totalTargets.toLocaleString()} host:port ` +
            `combinations. Proceeding may take a while and generate a lot of connection attempts.`;
          largeScanDialog.showModal();
          return;
        }
        showError(data.error || `Scan failed to start (HTTP ${res.status}).`);
        return;
      }
      window.location.href = '/results.html';
    } catch {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Scan';
      showError('Could not reach the server. Is rscan serve still running?');
    }
  }

  let lastSubmittedBody = null;

  largeScanCancelBtn.addEventListener('click', () => {
    largeScanDialog.close();
  });

  largeScanProceedBtn.addEventListener('click', () => {
    largeScanDialog.close();
    if (lastSubmittedBody) void submitScan({ ...lastSubmittedBody, force: true });
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    clearError();

    const cidrs = form.cidrs.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const body = {
      ports: form.ports.value.trim() || undefined,
      timeoutMs: Number(form.timeoutMs.value) || undefined,
      concurrency: Number(form.concurrency.value) || undefined,
      tls: form.tls.checked,
      tlsSkipVerify: form.tlsSkipVerify.checked,
    };
    if (cidrs.length > 0) body.cidrs = cidrs;
    if (form.password.value) {
      body.password = form.password.value;
      if (form.username.value) body.username = form.username.value;
    }

    lastSubmittedBody = body;
    void submitScan(body);
  });
})();
