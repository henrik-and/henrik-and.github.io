// Idle Detection API demo: permission, IdleDetector start/stop, live state,
// and an exportable event log. The API is event driven; the page only counts
// the time spent in the current state.
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('idle');
  const supported = typeof window.IdleDetector !== 'undefined';

  let detector = null;
  let controller = null;
  let running = false;
  let permission = 'unknown';
  let changeCount = 0;
  let stateSince = null;  // Date.now() when the current state started
  let previous = null;    // { userState, screenState }
  let tick = null;

  function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h ? `${h} h ${m} min ${sec} s` : m ? `${m} min ${sec} s` : `${sec} s`;
  }

  // ---------- Support and permission ----------

  async function queryPermission() {
    if (!navigator.permissions || !navigator.permissions.query) return 'unknown';
    try {
      const status = await navigator.permissions.query({ name: 'idle-detection' });
      status.onchange = () => {
        permission = status.state;
        dbg(`Permission changed to ${status.state}`);
        log.add('permission', `changed to ${status.state}`);
        render();
      };
      return status.state;
    } catch (err) {
      dbg('permissions.query(idle-detection) failed', err);
      return 'unknown';
    }
  }

  function renderSupport() {
    const chips = [
      supported ? chip('IdleDetector available', 'ok', 'check_circle')
                : chip('IdleDetector not available', 'bad', 'cancel'),
      window.isSecureContext ? chip('Secure context', 'ok', 'lock')
                             : chip('Not a secure context', 'bad', 'lock_open', 'The API requires HTTPS or localhost.'),
      permission === 'granted' ? chip('Permission granted', 'ok', 'verified_user')
        : permission === 'denied' ? chip('Permission denied', 'bad', 'gpp_bad', 'Reset it in the site settings (lock icon in the address bar).')
        : chip(`Permission: ${permission}`, 'warn', 'shield', 'Click Request permission.'),
    ];
    let policy = null;
    const fp = document.permissionsPolicy || document.featurePolicy;
    if (fp && typeof fp.features === 'function') {
      policy = fp.features().includes('idle-detection') ? fp.allowsFeature('idle-detection') : 'unknown-feature';
      chips.push(policy === true ? chip('Permissions policy allows "idle-detection"', 'ok', 'policy')
        : policy === false ? chip('Permissions policy blocks "idle-detection"', 'bad', 'block')
        : chip('Permissions policy "idle-detection" not listed', '', 'help'));
    }
    chips.push(debugChip());
    $('support-row').replaceChildren(...chips);
    dbg.group('Support checks', { supported, isSecureContext: window.isSecureContext, permission, policy });
  }

  // ---------- Rendering ----------

  function render() {
    const user = detector && running ? detector.userState : null;
    const screen = detector && running ? detector.screenState : null;
    $('user-value').textContent = user || '—';
    $('user-unit').textContent = user ? (screen === 'locked' ? 'screen locked' : 'screen unlocked') : '';
    const icon = $('user-icon');
    icon.textContent = screen === 'locked' ? 'lock' : user === 'idle' ? 'bedtime' : 'person';
    icon.dataset.state = user || '';

    setKv('v-user', user ?? (running ? 'null' : '—'), user === 'idle' ? 'no input for longer than the threshold' : user === 'active' ? 'recent keyboard or mouse input' : '');
    setKv('v-screen', screen ?? (running ? 'null' : '—'), screen === 'locked' ? 'screen saver or lock screen' : '');
    setKv('v-since', stateSince && running ? fmtDuration(Date.now() - stateSince) : '—');
    setKv('v-count', String(changeCount));
    setKv('v-threshold', `${$('threshold').value} s`, `${Number($('threshold').value) * 1000} ms passed to start()`);
    setKv('v-permission', permission);
    setKv('v-visibility', document.visibilityState, document.hasFocus() ? 'focused' : 'not focused');
    setKv('v-detector', running ? 'running' : 'not started');
    $('permission-btn').disabled = !supported || permission === 'granted';
    $('start-btn').disabled = !supported;
  }

  function setStartButton() {
    const btn = $('start-btn');
    btn.querySelector('.icon').textContent = running ? 'stop' : 'play_arrow';
    btn.querySelector('.label').textContent = running ? 'Stop detector' : 'Start detector';
    $('threshold').disabled = running;
  }

  // ---------- Log ----------

  function snapshot() {
    return {
      userState: detector && running ? detector.userState : null,
      screenState: detector && running ? detector.screenState : null,
      permission,
      running,
      thresholdMs: Number($('threshold').value) * 1000,
      visibility: document.visibilityState,
    };
  }

  const log = createLog({
    api: 'Idle Detection',
    spec: 'https://wicg.github.io/idle-detection/',
    filePrefix: 'idle-detection-log',
    snapshot,
    dbg,
  });

  // ---------- Actions ----------

  async function requestPermission() {
    dbg('Calling IdleDetector.requestPermission()');
    try {
      const result = await IdleDetector.requestPermission();
      permission = result;
      dbg(`requestPermission() resolved: ${result}`);
      log.add('requestPermission()', result);
    } catch (err) {
      dbg('requestPermission() rejected', err);
      log.add('error', `requestPermission() failed: ${err.name}: ${err.message}`);
    }
    renderSupport();
    render();
  }

  function onChange(ev) {
    const cur = { userState: detector.userState, screenState: detector.screenState };
    const parts = [];
    for (const k of Object.keys(cur)) {
      if (!previous || previous[k] !== cur[k]) parts.push(`${k} ${previous ? previous[k] : '—'} \u2192 ${cur[k]}`);
    }
    dbg.group(`event: change`, { event: ev, timeStamp: ev.timeStamp, isTrusted: ev.isTrusted, previous, current: cur, visibility: document.visibilityState });
    changeCount++;
    stateSince = Date.now();
    previous = cur;
    render();
    log.add('change', parts.join(', ') || 'no visible value change');
  }

  async function startDetector() {
    const thresholdSec = Number($('threshold').value);
    const threshold = Math.round(thresholdSec * 1000);
    controller = new AbortController();
    detector = new IdleDetector();
    detector.addEventListener('change', onChange);
    dbg(`start({ threshold: ${threshold} })`);
    try {
      await detector.start({ threshold, signal: controller.signal });
    } catch (err) {
      dbg('start() rejected', err);
      log.add('error', `start() failed: ${err.name}: ${err.message}`);
      detector = null;
      controller = null;
      render();
      return;
    }
    running = true;
    previous = { userState: detector.userState, screenState: detector.screenState };
    stateSince = Date.now();
    log.add('start()', `threshold=${threshold} ms, userState=${detector.userState}, screenState=${detector.screenState}`);
    tick = setInterval(() => setKv('v-since', fmtDuration(Date.now() - stateSince)), 1000);
    setStartButton();
    render();
  }

  function stopDetector() {
    if (controller) controller.abort();
    dbg('AbortController.abort() called');
    running = false;
    clearInterval(tick);
    tick = null;
    log.add('abort()', 'detector stopped');
    setStartButton();
    render();
  }

  // ---------- Init ----------

  async function init() {
    permission = supported ? await queryPermission() : 'n/a';
    renderSupport();
    $('permission-btn').addEventListener('click', requestPermission);
    $('start-btn').addEventListener('click', () => (running ? stopDetector() : startDetector()));
    $('threshold').addEventListener('input', render);
    const vis = () => {
      render();
      dbg(`visibility ${document.visibilityState}, focus ${document.hasFocus()}`);
    };
    document.addEventListener('visibilitychange', vis);
    window.addEventListener('focus', vis);
    window.addEventListener('blur', vis);
    if (!supported) log.add('unsupported', 'IdleDetector is not defined');
    else log.add('permission', `initial state ${permission}`);
    render();
    mountSystemDiagnostics(dbg);
  }

  init();
})();
