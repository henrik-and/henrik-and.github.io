// Network Information API demo: support checks, live readout, rounding
// checks, and an exportable event log. Event driven only; no polling.
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('netinfo');
  const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;

  const ECT_RANK = { 'slow-2g': 1, '2g': 2, '3g': 3, '4g': 4 };
  const FIELDS = ['effectiveType', 'downlink', 'rtt', 'saveData', 'type', 'downlinkMax'];

  // Rounding checks over every value seen.
  const seen = { downlink: new Set(), rtt: new Set() };
  let previous = null;

  function renderSupport() {
    const chips = [
      conn ? chip('navigator.connection available', 'ok', 'check_circle')
           : chip('navigator.connection not available', 'bad', 'cancel'),
    ];
    if (conn) {
      chips.push('onchange' in conn ? chip('change event supported', 'ok', 'notifications')
                                    : chip('change event not supported', 'warn', 'notifications_off'));
      chips.push(conn.type !== undefined ? chip('type exposed', 'ok', 'lan')
                                         : chip('type not exposed: needs the experimental flag on this platform', 'warn', 'flag', 'Chrome exposes type, downlinkMax, and typechange by default only on Android and ChromeOS (Blink feature NetInfoDownlinkMax). Enable chrome://flags/#enable-experimental-web-platform-features and relaunch Chrome.'));
    }
    chips.push(debugChip());
    $('support-row').replaceChildren(...chips);
    dbg.group('Support checks', {
      connection: conn,
      source: navigator.connection ? 'navigator.connection' : navigator.mozConnection ? 'navigator.mozConnection' : navigator.webkitConnection ? 'navigator.webkitConnection' : 'none',
      hasOnchange: conn ? 'onchange' in conn : false,
      typeExposed: conn ? conn.type !== undefined : false,
      downlinkMaxExposed: conn ? conn.downlinkMax !== undefined : false,
    });
    return !!conn;
  }

  function snapshot() {
    const s = { onLine: navigator.onLine };
    if (conn) {
      for (const f of FIELDS) {
        const v = conn[f];
        if (v !== undefined) s[f] = Number.isFinite(v) || typeof v !== 'number' ? v : String(v);
      }
    }
    return s;
  }

  // "rtt 50 -> 300, effectiveType 4g -> 3g" for fields that changed.
  function diff(prev, cur) {
    if (!prev) return '';
    const parts = [];
    for (const k of Object.keys(cur)) {
      if (prev[k] !== cur[k]) parts.push(`${k} ${prev[k]} \u2192 ${cur[k]}`);
    }
    return parts.length ? parts.join(', ') : 'no visible value change';
  }

  function isMultiple(v, step) {
    const q = v / step;
    const ok = Math.abs(q - Math.round(q)) < 1e-6;
    if (!ok) dbg(`value ${v} is not a multiple of ${step} (quotient ${q})`);
    return ok;
  }

  // steps: [{step, label}] from coarsest to finest. Reports the coarsest step
  // that every value seen is a multiple of.
  function roundingSummary(set, steps, fmt) {
    if (set.size === 0) return { text: '—', sub: 'no value seen yet' };
    const values = [...set];
    const max = Math.max(...values);
    const n = `${values.length} distinct value${values.length === 1 ? '' : 's'}`;
    for (const { step, label } of steps) {
      if (values.every((v) => Math.abs(v / step - Math.round(v / step)) < 1e-6)) {
        return { text: `all multiples of ${label}`, sub: `${n}, largest ${fmt(max)}` };
      }
    }
    const finest = steps[steps.length - 1];
    const bad = values.filter((v) => !isMultiple(v, finest.step));
    return { text: `${bad.length} not multiples of ${finest.label}`, sub: `for example ${fmt(bad[0])}; ${n}` };
  }

  function render() {
    if (!conn) return;
    const ect = conn.effectiveType;
    $('ect-value').textContent = ect || '—';
    $('ect-unit').textContent = ect ? 'effective type' : '';
    const rank = ECT_RANK[ect] || 0;
    $('ect-bar').style.width = `${rank * 25}%`;
    $('ect-meter').setAttribute('aria-valuenow', String(rank));

    setKv('v-ect', ect ?? 'undefined', ect ? `rank ${rank} of 4 (slow-2g, 2g, 3g, 4g)` : '');
    if (typeof conn.downlink === 'number') {
      seen.downlink.add(conn.downlink);
      setKv('v-downlink', `${conn.downlink} Mbit/s`, `${Math.round(conn.downlink * 1000)} kbit/s`);
    } else {
      setKv('v-downlink', 'undefined');
    }
    if (typeof conn.rtt === 'number') {
      seen.rtt.add(conn.rtt);
      setKv('v-rtt', `${conn.rtt} ms`, conn.rtt === 0 ? 'no estimate yet (Chrome reports 0 when unavailable)' : 'round-trip time estimate');
    } else {
      setKv('v-rtt', 'undefined');
    }
    setKv('v-save-data', String(conn.saveData), conn.saveData ? 'user asked for reduced data use' : '');
    setKv('v-type', conn.type ?? 'undefined',
        conn.type === undefined ? 'Chrome: Android and ChromeOS only, or with the experimental flag'
        : conn.type === 'unknown' ? 'online, but the active adapters are not all the same type (for example Wi-Fi plus a hidden tunnel such as IP-HTTPS)'
        : '');
    const dm = conn.downlinkMax;
    setKv('v-downlink-max', dm === undefined ? 'undefined' : String(dm),
        dm === undefined ? 'Chrome: Android and ChromeOS only' : dm === Infinity ? 'unknown' : 'Mbit/s');
    setKv('v-online', String(navigator.onLine));

    const dl = roundingSummary(seen.downlink,
        [{ step: 0.05, label: '50 kbit/s' }, { step: 0.025, label: '25 kbit/s' }], (v) => `${v} Mbit/s`);
    setKv('v-downlink-round', dl.text, dl.sub);
    const rt = roundingSummary(seen.rtt,
        [{ step: 50, label: '50 ms' }, { step: 25, label: '25 ms' }], (v) => `${v} ms`);
    setKv('v-rtt-round', rt.text, rt.sub);
    $('v-updated').textContent = new Date().toLocaleTimeString();
    dbg.table('Rendered state', [snapshot()]);
    dbg.group('Rounding checks', {
      downlink: { result: dl, valuesSeen: [...seen.downlink].sort((a, b) => a - b) },
      rtt: { result: rt, valuesSeen: [...seen.rtt].sort((a, b) => a - b) },
    });
  }

  const log = createLog({
    api: 'Network Information',
    spec: 'https://wicg.github.io/netinfo/',
    filePrefix: 'network-information-log',
    snapshot,
    dbg,
    extra: () => ({
      rounding: {
        downlinkValuesSeen: [...seen.downlink].sort((a, b) => a - b),
        rttValuesSeen: [...seen.rtt].sort((a, b) => a - b),
      },
    }),
  });

  function onEvent(name, ev) {
    const cur0 = snapshot();
    dbg.group(`event: ${name}`, {
      event: ev,
      timeStamp: ev ? ev.timeStamp : undefined,
      isTrusted: ev ? ev.isTrusted : undefined,
      visibilityState: document.visibilityState,
      previous,
      current: cur0,
      changed: diff(previous, cur0),
    });
    render();
    const cur = snapshot();
    log.add(name, diff(previous, cur));
    previous = cur;
  }

  function init() {
    window.addEventListener('online', (ev) => onEvent('online', ev));
    window.addEventListener('offline', (ev) => onEvent('offline', ev));
    if (!renderSupport()) {
      log.add('unsupported', 'navigator.connection is not defined');
      setKv('v-online', String(navigator.onLine));
      return;
    }
    render();
    previous = snapshot();
    log.add('initial', FIELDS.filter((f) => conn[f] !== undefined).map((f) => `${f}=${conn[f]}`).join(', '));
    conn.addEventListener('change', (ev) => onEvent('change', ev));
    dbg('Listening for change on navigator.connection and online/offline on window');
  }

  init();
  mountSystemDiagnostics(dbg);
})();
