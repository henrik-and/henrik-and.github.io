// Shared helpers for the device and session state Web API demos:
// support chips, key/value rows, and an exportable event log.
'use strict';

window.DemoKit = (() => {
  const $ = (id) => document.getElementById(id);

  // Debug mode: add ?debug=1 to the page URL for detailed console logs.
  const params = new URLSearchParams(location.search);
  const DEBUG = params.has('debug') && params.get('debug') !== '0';
  const TAG_STYLE = 'color:#0b57d0;font-weight:600';

  /**
   * Returns a console logger for one page, active only in debug mode.
   * dbg(...args) logs a line; dbg.group(label, ...objects) logs a collapsed
   * group; dbg.table(label, rows) logs a table.
   */
  function createDebug(tag) {
    const prefix = `[${tag}]`;
    const dbg = (...args) => {
      if (DEBUG) console.log(`%c${prefix}`, TAG_STYLE, ...args);
    };
    dbg.group = (label, ...objects) => {
      if (!DEBUG) return;
      console.groupCollapsed(`%c${prefix}%c ${label}`, TAG_STYLE, '');
      for (const o of objects) console.log(o);
      console.groupEnd();
    };
    dbg.table = (label, rows) => {
      if (!DEBUG) return;
      console.groupCollapsed(`%c${prefix}%c ${label}`, TAG_STYLE, '');
      console.table(rows);
      console.groupEnd();
    };
    dbg.enabled = DEBUG;
    if (DEBUG) {
      dbg.group('Debug logging on. Remove ?debug=1 from the URL to turn it off.', {
        page: location.href,
        userAgent: navigator.userAgent,
        userAgentData: navigator.userAgentData
          ? { brands: navigator.userAgentData.brands, platform: navigator.userAgentData.platform }
          : undefined,
        isSecureContext: window.isSecureContext,
        visibilityState: document.visibilityState,
        onLine: navigator.onLine,
        time: new Date().toISOString(),
      });
    }
    return dbg;
  }

  /** Support-row chip that shows the debug state and links to toggle it. */
  function debugChip() {
    const url = new URL(location.href);
    const a = document.createElement('a');
    if (DEBUG) {
      url.searchParams.delete('debug');
      a.className = 'chip info';
      a.title = 'Detailed logs are written to the DevTools console (F12 or Ctrl+Shift+J). Click to turn off.';
      a.innerHTML = '<span class="icon" aria-hidden="true">bug_report</span>Debug logging on';
    } else {
      url.searchParams.set('debug', '1');
      a.className = 'chip';
      a.title = 'Reloads the page with ?debug=1, which writes detailed logs to the DevTools console (F12 or Ctrl+Shift+J).';
      a.innerHTML = '<span class="icon" aria-hidden="true">bug_report</span>Debug logging off · add ?debug=1';
    }
    a.id = 'debug-chip';
    a.href = url.toString();
    return a;
  }

  function chip(text, kind, icon, title) {
    const el = document.createElement('span');
    el.className = `chip ${kind || ''}`.trim();
    if (title) el.title = title;
    const i = document.createElement('span');
    i.className = 'icon';
    i.setAttribute('aria-hidden', 'true');
    i.textContent = icon;
    el.append(i, document.createTextNode(text));
    return el;
  }

  const HIGHLIGHT_MS = 5000;

  /**
   * Sets a key/value cell. When the main value changes, it is highlighted for
   * 5 s (as in gum-demo) unless the cell has data-no-highlight, which is used
   * for values that change every second.
   */
  function setKv(id, text, sub) {
    const el = $(id);
    const value = String(text);
    const prev = el.dataset.prev;
    const now = Date.now();
    if (prev !== undefined && prev !== value && prev !== '—' && value !== '—' && !el.hasAttribute('data-no-highlight')) {
      el.dataset.hlUntil = String(now + HIGHLIGHT_MS);
    }
    const changed = prev !== value;
    el.dataset.prev = value;
    // Update in place when possible so a running highlight/pulse isn't restarted
    // by re-renders that don't change the value.
    let span = el.querySelector(':scope > .kv-value');
    if (!span || changed) {
      span = document.createElement('span');
      span.className = 'kv-value';
      span.textContent = value;
      const until = Number(el.dataset.hlUntil || 0);
      if (until > now) {
        span.classList.add('kv-changed');
        // Fade out when the highlight expires, even if the cell isn't re-rendered.
        setTimeout(() => span.classList.add('fade-out'), until - now);
      }
      el.replaceChildren(span);
    }
    let s = el.querySelector(':scope > .sub');
    if (sub) {
      if (!s) {
        s = document.createElement('span');
        s.className = 'sub';
        el.append(s);
      }
      if (s.textContent !== sub) s.textContent = sub;
    } else if (s) {
      s.remove();
    }
  }

  // Number of decimals needed to write the value exactly (0..6, 7 = more).
  function decimalsOf(v) {
    for (let d = 0; d <= 6; d++) {
      const scaled = v * 10 ** d;
      if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
    }
    return 7;
  }

  function timeStr(d) {
    return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  /**
   * Event log with Copy (tab-separated text), Download JSON, and Clear.
   * Expects elements: #event-log, #log-empty, #copy-log-btn,
   * #download-log-btn, #clear-log-btn.
   * @param {{api: string, spec: string, filePrefix: string,
   *          snapshot: () => object|null, extra?: () => object,
   *          dbg?: Function, formatTime?: (Date) => string}} opts
   */
  function createLog(opts) {
    const MAX = 500;
    const dbg = opts.dbg || (() => {});
    dbg.group = dbg.group || (() => {});
    const entries = [];
    const listEl = $('event-log');
    const emptyEl = $('log-empty');
    const copyBtn = $('copy-log-btn');
    const downloadBtn = $('download-log-btn');
    const clearBtn = $('clear-log-btn');

    function updateButtons() {
      copyBtn.disabled = entries.length === 0;
      downloadBtn.disabled = entries.length === 0;
    }

    function flash(btn, label) {
      const text = btn.querySelector('.label');
      const old = text.textContent;
      text.textContent = label;
      setTimeout(() => { text.textContent = old; }, 1500);
    }

    function add(name, detail) {
      const now = new Date();
      const entry = { time: now.toISOString(), event: name, detail, state: opts.snapshot() };
      entries.push(entry);
      if (entries.length > MAX) entries.shift();
      dbg.group(`log: ${name} - ${detail}`, entry);

      emptyEl.hidden = true;
      const li = document.createElement('li');
      li.className = 'new';
      const t = document.createElement('span');
      t.className = 't';
      t.textContent = opts.formatTime ? opts.formatTime(now) : timeStr(now);
      const e = document.createElement('span');
      e.className = 'e';
      e.textContent = name;
      const v = document.createElement('span');
      v.textContent = detail;
      li.append(t, e, v);
      listEl.prepend(li);
      while (listEl.children.length > MAX) listEl.lastElementChild.remove();
      updateButtons();
    }

    copyBtn.addEventListener('click', async () => {
      const lines = entries.map((x) => `${x.time}\t${x.event}\t${x.detail}`);
      try {
        await navigator.clipboard.writeText(lines.join('\n'));
        dbg(`Copied ${lines.length} log lines to the clipboard`);
        flash(copyBtn, 'Copied');
      } catch (err) {
        dbg('Copy to clipboard failed', err);
        flash(copyBtn, 'Copy failed');
      }
    });

    downloadBtn.addEventListener('click', () => {
      const report = {
        api: opts.api,
        spec: opts.spec,
        exportedAt: new Date().toISOString(),
        page: location.href,
        userAgent: navigator.userAgent,
        systemDiagnostics: lastDiagnostics,
        ...(opts.extra ? opts.extra() : {}),
        events: entries,
      };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `${opts.filePrefix}-${stamp}.json`;
      dbg.group(`Downloading ${a.download} (${entries.length} events)`, report);
      document.body.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    clearBtn.addEventListener('click', () => {
      dbg(`Cleared ${entries.length} log entries`);
      entries.length = 0;
      listEl.replaceChildren();
      emptyEl.hidden = false;
      updateButtons();
    });

    updateButtons();
    return { add, entries };
  }

  // ---------- System diagnostics ----------

  let lastDiagnostics = null;

  function parseUaBrowser(ua) {
    const m = ua.match(/(Edg|OPR|Chrome|Firefox|Version)\/([\d.]+)/);
    if (!m) return 'Unknown';
    const names = { Edg: 'Microsoft Edge', OPR: 'Opera', Chrome: 'Chrome', Firefox: 'Firefox', Version: 'Safari' };
    return `${names[m[1]]} ${m[2]}`;
  }

  function osLabel(platform, platformVersion, ua) {
    if (platform === 'Windows' && platformVersion) {
      const major = parseInt(platformVersion, 10);
      return `${major >= 13 ? 'Windows 11' : 'Windows 10 or older'} (platform version ${platformVersion})`;
    }
    if (platform && platformVersion) return `${platform} ${platformVersion}`;
    if (platform) return platform;
    if (/Windows/.test(ua)) return 'Windows';
    if (/Android/.test(ua)) return 'Android';
    if (/iPhone|iPad/.test(ua)) return 'iOS';
    if (/Mac OS X/.test(ua)) return 'macOS';
    if (/CrOS/.test(ua)) return 'ChromeOS';
    if (/Linux/.test(ua)) return 'Linux';
    return 'Unknown';
  }

  async function permissionState(name) {
    if (!navigator.permissions || !navigator.permissions.query) return 'Permissions API not available';
    try {
      return (await navigator.permissions.query({ name })).state;
    } catch {
      return 'not queryable';
    }
  }

  /** Browser, OS, hardware, and API support for this site's demos. */
  async function collectSystemDiagnostics() {
    const ua = navigator.userAgent;
    const uad = navigator.userAgentData;
    let he = null;
    if (uad && uad.getHighEntropyValues) {
      try {
        he = await uad.getHighEntropyValues(['platformVersion', 'architecture', 'bitness', 'model', 'fullVersionList']);
      } catch { he = null; }
    }
    let browser = parseUaBrowser(ua);
    if (he && Array.isArray(he.fullVersionList)) {
      const real = he.fullVersionList.filter((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand));
      const pick = real[0] || he.fullVersionList.find((b) => b.brand === 'Chromium');
      if (pick) browser = `${pick.brand} ${pick.version}`;
    }
    const mq = (q) => (window.matchMedia ? window.matchMedia(q).matches : undefined);
    const diag = {
      browser,
      os: osLabel(uad ? uad.platform : '', he ? he.platformVersion : '', ua),
      architecture: he && he.architecture ? `${he.architecture}${he.bitness ? ` ${he.bitness}-bit` : ''}` : 'unknown',
      deviceModel: he && he.model ? he.model : undefined,
      mobile: uad ? uad.mobile : /Mobi/.test(ua),
      secureContext: window.isSecureContext,
      origin: location.origin,
      visibility: document.visibilityState,
      hasFocus: document.hasFocus(),
      logicalCores: navigator.hardwareConcurrency || 'unknown',
      deviceMemoryGB: navigator.deviceMemory || 'unknown',
      onLine: navigator.onLine,
      language: navigator.language,
      prefersColorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
      apis: {
        'Battery Status (navigator.getBattery)': typeof navigator.getBattery === 'function',
        'Network Information (navigator.connection)': !!navigator.connection,
        'Compute Pressure (PressureObserver)': typeof window.PressureObserver !== 'undefined',
        'Idle Detection (IdleDetector)': typeof window.IdleDetector !== 'undefined',
        'Audio Session (navigator.audioSession)': !!navigator.audioSession,
        'Audio Output (navigator.audioOutput)': !!navigator.audioOutput,
        'Media queries (matchMedia)': typeof window.matchMedia === 'function',
        'MediaStreamTrack': typeof window.MediaStreamTrack !== 'undefined',
        'Permissions API': !!(navigator.permissions && navigator.permissions.query),
      },
      permissions: {
        'idle-detection': await permissionState('idle-detection'),
      },
      userAgent: ua,
    };
    lastDiagnostics = diag;
    return diag;
  }

  function yesNoChip(ok) {
    return ok ? chip('Yes', 'ok', 'check_circle') : chip('No', 'bad', 'cancel');
  }

  function row(dl, label, value) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    if (value instanceof Node) dd.append(value); else dd.textContent = String(value);
    dl.append(dt, dd);
    return dd;
  }

  /**
   * Replaces #system-diagnostics-mount with a collapsible System diagnostics
   * panel. Kept separate from the API demos themselves.
   */
  async function mountSystemDiagnostics(dbg) {
    const mount = $('system-diagnostics-mount');
    if (!mount) return;
    const details = document.createElement('details');
    details.className = 'panel disclosure';
    details.id = 'system-diagnostics';
    details.innerHTML = `
      <summary>
        <span class="icon" aria-hidden="true">computer</span>
        <span class="disclosure-text"><strong>System diagnostics</strong><span class="disclosure-sub" id="sysdiag-sub">Browser, OS, hardware, and API support on this device</span></span>
        <span class="icon disclosure-chevron" aria-hidden="true">expand_more</span>
      </summary>
      <div class="disclosure-body">
        <dl class="kv" id="sysdiag-list"></dl>
        <details class="ua-raw"><summary>Raw user agent</summary><pre class="mono" id="sysdiag-ua"></pre></details>
        <div class="disclosure-actions">
          <button class="btn" id="sysdiag-copy-btn" type="button"><span class="icon" aria-hidden="true">content_copy</span><span class="label">Copy as JSON</span></button>
          <button class="btn" id="sysdiag-refresh-btn" type="button"><span class="icon" aria-hidden="true">refresh</span><span class="label">Refresh</span></button>
        </div>
      </div>`;
    mount.replaceWith(details);

    async function render() {
      const d = await collectSystemDiagnostics();
      if (dbg) dbg.group('System diagnostics', d);
      const dl = $('sysdiag-list');
      dl.replaceChildren();
      $('sysdiag-sub').textContent = `${d.browser} · ${d.os} · ${d.logicalCores} cores`;
      row(dl, 'Browser', d.browser);
      row(dl, 'OS', d.os);
      row(dl, 'Architecture', d.architecture);
      if (d.deviceModel) row(dl, 'Device model', d.deviceModel);
      row(dl, 'Secure context', yesNoChip(d.secureContext));
      row(dl, 'Origin', d.origin);
      const vis = row(dl, 'Visibility / focus', `${d.visibility}, ${d.hasFocus ? 'focused' : 'not focused'}`);
      vis.id = 'sysdiag-visibility';
      row(dl, 'Logical cores', d.logicalCores);
      row(dl, 'Device memory', d.deviceMemoryGB === 'unknown' ? 'unknown' : `${d.deviceMemoryGB} GB (rounded by the browser)`);
      row(dl, 'Online', String(d.onLine));
      row(dl, 'Language', d.language);
      const apis = document.createElement('div');
      apis.className = 'chip-wrap';
      for (const [name, ok] of Object.entries(d.apis)) {
        apis.append(ok ? chip(name, 'ok', 'check_circle') : chip(name, 'bad', 'cancel'));
      }
      row(dl, 'APIs available', apis);
      row(dl, 'idle-detection permission', d.permissions['idle-detection']);
      $('sysdiag-ua').textContent = d.userAgent;
    }

    const updateVisibility = () => {
      const el = $('sysdiag-visibility');
      if (el) el.textContent = `${document.visibilityState}, ${document.hasFocus() ? 'focused' : 'not focused'}`;
    };
    document.addEventListener('visibilitychange', updateVisibility);
    window.addEventListener('focus', updateVisibility);
    window.addEventListener('blur', updateVisibility);

    $('sysdiag-refresh-btn').addEventListener('click', render);
    $('sysdiag-copy-btn').addEventListener('click', async (ev) => {
      const label = ev.currentTarget.querySelector('.label');
      try {
        await navigator.clipboard.writeText(JSON.stringify(lastDiagnostics, null, 2));
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Copy failed';
      }
      setTimeout(() => { label.textContent = 'Copy as JSON'; }, 1500);
    });
    await render();
  }

  return { $, chip, setKv, decimalsOf, createLog, createDebug, debugChip, mountSystemDiagnostics,
           getLastDiagnostics: () => lastDiagnostics, DEBUG };
})();
