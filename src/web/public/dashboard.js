(function () {
  const form = document.getElementById('scan-form');
  const errorBanner = document.getElementById('error-banner');
  const submitBtn = document.getElementById('submit-btn');
  const csvUpload = document.getElementById('csv-upload');
  const csvUploadStatus = document.getElementById('csv-upload-status');

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
  // uploaded anywhere. It just replaces the Targets/Ports fields, so
  // everything downstream (submit, sessionStorage, scan-size validation)
  // works exactly as if the targets had been typed by hand.
  csvUpload.addEventListener('change', () => {
    const file = csvUpload.files[0];
    csvUploadStatus.textContent = '';
    csvUploadStatus.classList.remove('error');
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const rows = String(reader.result || '')
        .split(/\r\n|\r|\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split(',').map((cell) => cell.trim()));

      // Skip an optional header row, e.g. "host,port" or "hostname,ip".
      if (rows.length > 0 && /^(host|hostname|ip|ip ?address|target)s?$/i.test(rows[0][0])) {
        rows.shift();
      }

      const hosts = new Set();
      const ports = new Set();
      for (const [host, port] of rows) {
        if (host) hosts.add(host);
        if (port) ports.add(port);
      }

      csvUpload.value = ''; // lets re-uploading the same filename fire 'change' again

      if (hosts.size === 0) {
        csvUploadStatus.textContent = `No targets found in ${file.name}.`;
        csvUploadStatus.classList.add('error');
        return;
      }

      form.cidrs.value = Array.from(hosts).join('\n');
      fireInput(form.cidrs);
      if (ports.size > 0) {
        form.ports.value = Array.from(ports).join(',');
        fireInput(form.ports);
      }

      csvUploadStatus.textContent =
        `Loaded ${hosts.size} target${hosts.size === 1 ? '' : 's'} from ${file.name}` +
        (ports.size > 0 ? ` (ports: ${Array.from(ports).join(', ')})` : '');
    };
    reader.onerror = () => {
      csvUpload.value = '';
      csvUploadStatus.textContent = `Could not read ${file.name}.`;
      csvUploadStatus.classList.add('error');
    };
    reader.readAsText(file);
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Starting…';

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

    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        showError(data.error || `Scan failed to start (HTTP ${res.status}).`);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Start Scan';
        return;
      }
      window.location.href = '/results.html';
    } catch {
      showError('Could not reach the server. Is rscan serve still running?');
      submitBtn.disabled = false;
      submitBtn.textContent = 'Start Scan';
    }
  });
})();
