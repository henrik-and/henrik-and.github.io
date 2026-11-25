// Battery Status API demo: support checks, live readout, precision, and an
// exportable event log. Event driven only; the page does not poll.
'use strict';

(() => {
  const { $, chip, setKv, decimalsOf, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('battery');
  let battery = null;

  // Precision tracking: distinct level values seen and the smallest step
  // between consecutive levelchange values.
  const seenLevels = new Set();
  let lastLevel = null;
  let minStep = null;

  function renderSupport() {
    const hasApi = typeof navigator.getBattery === 'function';
    const secure = window.isSecureContext;
    // allowsFeature() returns false for features the browser doesn't know, so
    // only trust it when "battery" is in the browser's policy feature list.
    let policy = null;
    const fp = document.permissionsPolicy || document.featurePolicy;
    if (fp && typeof fp.allowsFeature === 'function' && typeof fp.features === 'function') {
      try {
        policy = fp.features().includes('battery') ? fp.allowsFeature('battery') : 'unknown-feature';
      } catch { policy = null; }
    }
    $('support-row').replaceChildren(
      hasApi ? chip('navigator.getBattery() available', 'ok', 'check_circle')
             : chip('navigator.getBattery() not available', 'bad', 'cancel'),
      secure ? chip('Secure context', 'ok', 'lock')
             : chip('Not a secure context', 'bad', 'lock_open', 'The API requires HTTPS or localhost.'),
      policy === null ? chip('Permissions policy: unknown', '', 'help', 'document.permissionsPolicy is not available in this browser.')
        : policy === 'unknown-feature' ? chip('Permissions policy "battery" not enforced', '', 'help', 'This browser does not list "battery" as a permissions policy feature.')
        : policy ? chip('Permissions policy allows "battery"', 'ok', 'policy')
                 : chip('Permissions policy blocks "battery"', 'bad', 'block'),
      debugChip(),
    );
    dbg.group('Support checks', {
      getBatteryType: typeof navigator.getBattery,
      isSecureContext: secure,
      permissionsPolicyApi: fp ? (document.permissionsPolicy ? 'document.permissionsPolicy' : 'document.featurePolicy') : 'none',
      policyFeatures: fp && typeof fp.features === 'function' ? fp.features() : undefined,
      batteryPolicy: policy,
    });
    return hasApi;
  }

  function formatSeconds(s) {
    if (s === Infinity) return { text: 'Infinity', sub: 'unknown, or not applicable in this state' };
    if (s === 0) return { text: '0', sub: 'full' };
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return { text: `${s} s`, sub: h > 0 ? `${h} h ${m} min` : `${m} min` };
  }

  function trackLevel(level) {
    seenLevels.add(level);
    if (lastLevel !== null && level !== lastLevel) {
      const step = Math.abs(level - lastLevel);
      minStep = minStep === null ? step : Math.min(minStep, step);
      dbg(`level ${lastLevel} -> ${level} (step ${Number(step.toFixed(6))}, decimals ${decimalsOf(level)}, smallest step so far ${Number(minStep.toFixed(6))})`);
    } else {
      dbg(`level ${level} (decimals ${decimalsOf(level)})`);
    }
    lastLevel = level;
  }

  // Most decimals seen in any level value. 0 and 1 say nothing about precision.
  function maxDecimalsSeen() {
    let max = null;
    for (const v of seenLevels) {
      if (v === 0 || v === 1) continue;
      const d = decimalsOf(v);
      max = max === null ? d : Math.max(max, d);
    }
    return max;
  }

  function renderPrecision() {
    const d = maxDecimalsSeen();
    if (d === null) {
      setKv('v-decimals', '—', `level is ${battery.level}, which shows nothing; wait for a value below 100 %`);
    } else {
      const unit = 10 ** -d;
      setKv('v-decimals', `${d} decimal${d === 1 ? '' : 's'}`,
          `values seen so far are multiples of ${unit.toFixed(d)} (${Number((unit * 100).toFixed(4))} %)`);
    }
    if (minStep === null) {
      setKv('v-min-step', '—', `no level change seen yet (${seenLevels.size} distinct value${seenLevels.size === 1 ? '' : 's'})`);
    } else {
      const step = Number(minStep.toFixed(6));
      setKv('v-min-step', String(step), `${Number((step * 100).toFixed(4))} %, from ${seenLevels.size} distinct values`);
    }
  }

  function render() {
    if (!battery) return;
    const pct = battery.level * 100;
    const pctText = Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
    $('level-pct').textContent = pctText;
    $('level-unit').textContent = '%';
    $('level-bar').style.width = `${pct}%`;
    const meter = $('level-meter');
    meter.setAttribute('aria-valuenow', String(Math.round(pct)));
    meter.classList.toggle('charging', battery.charging);

    setKv('v-level', String(battery.level), `${pctText} %`);
    setKv('v-charging', String(battery.charging), battery.charging ? 'plugged in' : 'on battery');
    const ct = formatSeconds(battery.chargingTime);
    setKv('v-charging-time', ct.text, ct.sub);
    const dt = formatSeconds(battery.dischargingTime);
    setKv('v-discharging-time', dt.text, dt.sub);
    renderPrecision();
    $('v-updated').textContent = new Date().toLocaleTimeString();
    dbg.table('Rendered state', [{ ...snapshot(), levelDecimals: maxDecimalsSeen(), smallestStep: minStep }]);
  }

  function snapshot() {
    if (!battery) return null;
    // JSON has no Infinity, so keep it as a string.
    const num = (v) => (Number.isFinite(v) ? v : String(v));
    return {
      level: battery.level,
      charging: battery.charging,
      chargingTime: num(battery.chargingTime),
      dischargingTime: num(battery.dischargingTime),
    };
  }

  const log = createLog({
    api: 'Battery Status',
    spec: 'https://w3c.github.io/battery/',
    filePrefix: 'battery-status-log',
    snapshot,
    dbg,
    extra: () => ({
      precision: battery ? {
        levelDecimals: maxDecimalsSeen(),
        smallestObservedStep: minStep === null ? null : Number(minStep.toFixed(6)),
        distinctLevelsSeen: [...seenLevels].sort((a, b) => a - b),
      } : null,
    }),
  });

  async function init() {
    if (!renderSupport()) {
      log.add('unsupported', 'navigator.getBattery is not defined');
      return;
    }
    const t0 = performance.now();
    dbg('Calling navigator.getBattery()');
    try {
      battery = await navigator.getBattery();
    } catch (err) {
      dbg('navigator.getBattery() rejected', err);
      log.add('error', `${err.name}: ${err.message}`);
      return;
    }
    dbg.group(`navigator.getBattery() resolved in ${(performance.now() - t0).toFixed(1)} ms`, battery, snapshot());
    trackLevel(battery.level);
    render();
    log.add('getBattery()', `level=${battery.level}, charging=${battery.charging}`);

    const handlers = {
      levelchange: () => `level=${battery.level}`,
      chargingchange: () => `charging=${battery.charging}`,
      chargingtimechange: () => `chargingTime=${battery.chargingTime}`,
      dischargingtimechange: () => `dischargingTime=${battery.dischargingTime}`,
    };
    for (const [type, describe] of Object.entries(handlers)) {
      battery.addEventListener(type, (ev) => {
        dbg.group(`event: ${type}`, {
          event: ev,
          timeStamp: ev.timeStamp,
          isTrusted: ev.isTrusted,
          visibilityState: document.visibilityState,
          state: snapshot(),
        });
        if (type === 'levelchange') trackLevel(battery.level);
        render();
        log.add(type, describe());
      });
    }
  }

  init();
  mountSystemDiagnostics(dbg);
})();
