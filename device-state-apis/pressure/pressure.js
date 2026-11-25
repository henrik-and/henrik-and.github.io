// Compute Pressure API demo: PressureObserver on "cpu", live readout, history
// chart, CPU load generator, UI-only simulation, and an exportable log.
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('pressure');
  const supported = typeof window.PressureObserver !== 'undefined';

  const STATES = ['nominal', 'fair', 'serious', 'critical'];
  const LABELS = { nominal: 'light load', fair: 'moderate load', serious: 'high load', critical: 'heavy load' };
  const HISTORY_MS = 60000;

  let observer = null;
  let observing = false;
  let latest = null;          // { state, source, time, ownContributionEstimate, simulated }
  let recordCount = 0;
  let lastRecordAt = null;    // performance.now() of the previous real record
  const intervals = [];
  const history = [];         // { t: Date.now(), state, simulated }
  let chartTimer = null;
  let simTimer = null;
  const workers = [];

  // ---------- Support ----------

  function renderSupport() {
    const chips = [
      supported ? chip('PressureObserver available', 'ok', 'check_circle')
                : chip('PressureObserver not available', 'bad', 'cancel'),
      window.isSecureContext ? chip('Secure context', 'ok', 'lock')
                             : chip('Not a secure context', 'bad', 'lock_open', 'The API requires HTTPS or localhost.'),
    ];
    let sources = null;
    if (supported) {
      sources = PressureObserver.knownSources;
      chips.push(Array.isArray(sources) && sources.includes('cpu')
          ? chip(`knownSources: ${sources.join(', ')}`, 'ok', 'memory')
          : chip(`knownSources: ${Array.isArray(sources) ? sources.join(', ') || 'none' : 'unknown'}`, 'warn', 'memory'));
    }
    let policy = null;
    const fp = document.permissionsPolicy || document.featurePolicy;
    if (fp && typeof fp.features === 'function') {
      policy = fp.features().includes('compute-pressure') ? fp.allowsFeature('compute-pressure') : 'unknown-feature';
      chips.push(policy === true ? chip('Permissions policy allows "compute-pressure"', 'ok', 'policy')
        : policy === false ? chip('Permissions policy blocks "compute-pressure"', 'bad', 'block')
        : chip('Permissions policy "compute-pressure" not listed', '', 'help'));
    }
    chips.push(debugChip());
    $('support-row').replaceChildren(...chips);
    dbg.group('Support checks', { supported, isSecureContext: window.isSecureContext, knownSources: sources, policy });
  }

  // ---------- Rendering ----------

  function setStateDisplay(state, simulated) {
    const idx = STATES.indexOf(state);
    $('state-value').textContent = state || '—';
    $('state-unit').textContent = state ? `${LABELS[state] || ''}${simulated ? ' (simulated)' : ''}` : '';
    $('state-bar').style.width = `${(idx + 1) * 25}%`;
    const meter = $('state-meter');
    meter.setAttribute('aria-valuenow', String(idx + 1));
    meter.dataset.state = state || '';
  }

  function render() {
    if (latest) {
      setStateDisplay(latest.state, latest.simulated);
      setKv('v-state', latest.state, latest.simulated ? 'simulated, not from the browser' : `${STATES.indexOf(latest.state) + 1} of 4`);
      setKv('v-source', latest.source || '—');
      setKv('v-time', latest.time != null ? `${latest.time.toFixed(1)} ms` : '—', latest.time != null ? 'performance.now() time base' : '');
      setKv('v-own', latest.ownContributionEstimate === undefined ? 'undefined' : String(latest.ownContributionEstimate),
          latest.ownContributionEstimate === undefined ? 'not exposed by this browser' : 'share caused by this page (0–1)');
    }
    setKv('v-count', String(recordCount));
    if (intervals.length) {
      const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      setKv('v-interval', `${(intervals[intervals.length - 1] / 1000).toFixed(1)} s`, `last; average ${(avg / 1000).toFixed(1)} s over ${intervals.length}`);
    }
    renderFocus();
    setKv('v-observer', observing ? 'observing "cpu"' : 'not observing',
        observing ? `sampleInterval ${$('sample-interval').value} ms` : '');
  }

  function renderFocus() {
    const focused = document.hasFocus();
    setKv('v-focus', focused ? 'focused' : 'not focused', focused ? '' : 'records are paused until the page has focus again');
  }

  // ---------- History chart ----------

  // Custom properties hold light-dark(...) values, which canvas can't parse.
  // Resolve them to rgb() through the computed `color` of a hidden probe.
  let colorProbe = null;
  function cssVar(name) {
    if (!colorProbe) {
      colorProbe = document.createElement('span');
      colorProbe.style.display = 'none';
      document.body.append(colorProbe);
    }
    colorProbe.style.color = `var(${name})`;
    return getComputedStyle(colorProbe).color;
  }

  function cssFont(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function stateColor(state) {
    return cssVar(`--pressure-${state}`) || '#888';
  }

  function drawChart() {
    const canvas = $('history-canvas');
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth;
    const cssH = 140;
    if (canvas.width !== Math.round(cssW * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    const padL = 72, padR = 8, padT = 8, padB = 20;
    const w = cssW - padL - padR;
    const h = cssH - padT - padB;
    const yOf = (state) => padT + h - (STATES.indexOf(state) + 0.5) / 4 * h;
    const now = Date.now();
    const xOf = (t) => padL + w - ((now - t) / HISTORY_MS) * w;

    ctx.font = `12px ${cssFont('--font-plain') || 'sans-serif'}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'right';
    for (const s of STATES) {
      const y = yOf(s);
      ctx.strokeStyle = cssVar('--outline-variant');
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(padL + w, y);
      ctx.stroke();
      ctx.fillStyle = cssVar('--on-surface-variant');
      ctx.fillText(s, padL - 8, y);
    }
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const [label, ago] of [['-60 s', 60000], ['-30 s', 30000], ['now', 0]]) {
      const x = Math.min(Math.max(xOf(now - ago), padL + 14), padL + w - 12);
      ctx.fillText(label, x, padT + h + 4);
    }

    const pts = history.filter((p) => now - p.t <= HISTORY_MS + 5000);
    if (!pts.length) return;
    // Step line: hold each state until the next record, then until now.
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const x1 = Math.max(xOf(p.t), padL);
      const x2 = i + 1 < pts.length ? xOf(pts[i + 1].t) : xOf(now);
      if (x2 < padL) continue;
      const y = yOf(p.state);
      ctx.strokeStyle = stateColor(p.state);
      ctx.lineWidth = 2;
      ctx.setLineDash(p.simulated ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(x1, y);
      ctx.lineTo(x2, y);
      if (i + 1 < pts.length) ctx.lineTo(x2, yOf(pts[i + 1].state));
      ctx.stroke();
      ctx.setLineDash([]);
      if (xOf(p.t) >= padL) {
        ctx.fillStyle = stateColor(p.state);
        ctx.beginPath();
        ctx.arc(x1, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function ensureChartTimer() {
    const needed = observing || !!simTimer;
    if (needed && !chartTimer) chartTimer = setInterval(drawChart, 1000);
    if (!needed && chartTimer) { clearInterval(chartTimer); chartTimer = null; }
    drawChart();
  }

  // ---------- Log ----------

  function snapshot() {
    return latest ? { ...latest, recordCount, observing, hasFocus: document.hasFocus() } : { observing, hasFocus: document.hasFocus() };
  }

  const log = createLog({
    api: 'Compute Pressure',
    spec: 'https://w3c.github.io/compute-pressure/',
    filePrefix: 'compute-pressure-log',
    snapshot,
    dbg,
    extra: () => ({
      sampleIntervalMs: Number($('sample-interval').value),
      history: history.map((p) => ({ time: new Date(p.t).toISOString(), state: p.state, simulated: p.simulated })),
      intervalsMs: intervals.map((v) => Math.round(v)),
    }),
  });

  // ---------- Observer ----------

  function onRecords(records) {
    for (const r of records) {
      const json = typeof r.toJSON === 'function' ? r.toJSON() : { state: r.state, source: r.source, time: r.time };
      dbg.group(`PressureRecord: ${r.state}`, { record: r, json, hasFocus: document.hasFocus(), visibility: document.visibilityState });
      const nowPerf = performance.now();
      if (lastRecordAt !== null) intervals.push(nowPerf - lastRecordAt);
      if (intervals.length > 100) intervals.shift();
      lastRecordAt = nowPerf;
      recordCount++;
      if (simTimer) {
        // Keep the simulated display, but still log the real record.
        log.add('record', `${r.state} (source=${r.source}, time=${r.time.toFixed(1)}; display shows the simulation)`);
        continue;
      }
      const prev = latest ? latest.state : null;
      latest = { state: r.state, source: r.source, time: r.time, ownContributionEstimate: r.ownContributionEstimate, simulated: false };
      history.push({ t: Date.now(), state: r.state, simulated: false });
      render();
      drawChart();
      log.add('record', `${prev ? `${prev} \u2192 ` : ''}${r.state} (source=${r.source}, time=${r.time.toFixed(1)})`);
    }
  }

  async function startObserving() {
    const sampleInterval = Math.max(0, Number($('sample-interval').value) || 0);
    observer = new PressureObserver(onRecords);
    dbg(`observe("cpu", { sampleInterval: ${sampleInterval} })`);
    const t0 = performance.now();
    try {
      await observer.observe('cpu', { sampleInterval });
    } catch (err) {
      dbg('observe() rejected', err);
      log.add('error', `observe() failed: ${err.name}: ${err.message}`);
      observer = null;
      return;
    }
    dbg(`observe() resolved in ${(performance.now() - t0).toFixed(1)} ms`);
    observing = true;
    lastRecordAt = null;
    log.add('observe()', `source=cpu, sampleInterval=${sampleInterval} ms`);
    setObserveButton();
    render();
    ensureChartTimer();
  }

  function stopObserving() {
    if (observer) {
      const pending = typeof observer.takeRecords === 'function' ? observer.takeRecords() : [];
      if (pending.length) onRecords(pending);
      observer.disconnect();
      dbg('disconnect()', { pendingRecordsTaken: pending.length });
    }
    observer = null;
    observing = false;
    log.add('disconnect()', 'stopped observing');
    setObserveButton();
    render();
    ensureChartTimer();
  }

  function setObserveButton() {
    const btn = $('observe-btn');
    btn.querySelector('.icon').textContent = observing ? 'stop' : 'play_arrow';
    btn.querySelector('.label').textContent = observing ? 'Stop observing' : 'Start observing';
    $('sample-interval').disabled = observing;
  }

  // ---------- CPU load generator ----------

  const WORKER_SRC = 'self.onmessage = () => { for (;;) { Math.sqrt(Math.random()); } };';

  function toggleLoad() {
    const btn = $('load-btn');
    if (workers.length) {
      workers.forEach((w) => w.terminate());
      dbg(`Stopped ${workers.length} load workers`);
      log.add('load', `stopped ${workers.length} worker${workers.length === 1 ? '' : 's'}`);
      workers.length = 0;
    } else {
      const n = Math.max(1, Math.min(Number($('load-workers').value) || 1, 64));
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        w.postMessage('go');
        workers.push(w);
      }
      URL.revokeObjectURL(url);
      dbg(`Started ${n} busy-loop workers (${navigator.hardwareConcurrency || '?'} logical cores)`);
      log.add('load', `started ${n} busy-loop worker${n === 1 ? '' : 's'} of ${navigator.hardwareConcurrency || '?'} cores`);
    }
    const on = workers.length > 0;
    btn.querySelector('.label').textContent = on ? `Stop CPU load (${workers.length})` : 'Generate CPU load';
    btn.classList.toggle('btn-active', on);
    $('load-workers').disabled = on;
  }

  // ---------- Simulation (UI only) ----------

  function runSimulation() {
    if (simTimer) return;
    const seq = ['nominal', 'fair', 'serious', 'critical', 'serious', 'fair', 'nominal'];
    let i = 0;
    const btn = $('simulate-btn');
    btn.disabled = true;
    const step = () => {
      if (i >= seq.length) {
        clearInterval(simTimer);
        simTimer = null;
        btn.disabled = false;
        log.add('simulated', 'cycle finished');
        ensureChartTimer();
        return;
      }
      const s = seq[i++];
      latest = { state: s, source: 'cpu', time: performance.now(), ownContributionEstimate: undefined, simulated: true };
      history.push({ t: Date.now(), state: s, simulated: true });
      dbg(`Simulated state: ${s}`);
      log.add('simulated', s);
      render();
      drawChart();
    };
    simTimer = setInterval(step, 1500);
    ensureChartTimer();
    step();
  }

  // ---------- Init ----------

  function init() {
    renderSupport();
    const cores = navigator.hardwareConcurrency;
    if (cores) {
      $('load-workers').max = String(cores);
      $('load-workers').value = String(Math.max(1, Math.floor(cores / 2)));
      $('load-workers-max').textContent = `of ${cores}`;
    }
    $('observe-btn').disabled = !supported;
    $('observe-btn').addEventListener('click', () => (observing ? stopObserving() : startObserving()));
    $('load-btn').addEventListener('click', toggleLoad);
    $('simulate-btn').addEventListener('click', runSimulation);
    for (const type of ['focus', 'blur']) {
      window.addEventListener(type, () => {
        renderFocus();
        if (observing) log.add(type, type === 'blur' ? 'page lost focus: records pause' : 'page has focus: records resume');
        dbg(`window ${type}`, { hasFocus: document.hasFocus(), visibility: document.visibilityState });
      });
    }
    window.addEventListener('resize', drawChart);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawChart);
    if (!supported) log.add('unsupported', 'PressureObserver is not defined');
    render();
    drawChart();
    mountSystemDiagnostics(dbg);
  }

  init();
})();
