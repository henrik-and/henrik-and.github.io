// User preference media queries demo: evaluates each media feature with
// matchMedia() and logs MediaQueryList change events. No polling.
'use strict';

(() => {
  const { $, chip, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('media-queries');
  const MDN = 'https://developer.mozilla.org/en-US/docs/Web/CSS/@media/';
  const SPEC = 'https://drafts.csswg.org/mediaqueries-5/#descdef-media-';

  // values: in order; the first matching value is the current one.
  const FEATURES = [
    { name: 'prefers-color-scheme', values: ['light', 'dark'], mdn: true,
      hint: 'Dark or light theme in the OS or browser.' },
    { name: 'prefers-contrast', values: ['no-preference', 'more', 'less', 'custom'], mdn: true,
      hint: 'Higher or lower contrast. Windows contrast themes report more or custom.' },
    { name: 'prefers-reduced-motion', values: ['no-preference', 'reduce'], mdn: true,
      hint: 'Fewer animations (Windows: Animation effects off).' },
    { name: 'prefers-reduced-transparency', values: ['no-preference', 'reduce'], mdn: true,
      hint: 'Fewer transparency and blur effects.' },
    { name: 'prefers-reduced-data', values: ['no-preference', 'reduce'], mdn: true, flag: true,
      hint: 'Data saver. Behind the experimental flag in Chrome.' },
    { name: 'forced-colors', values: ['none', 'active'], mdn: true,
      hint: 'A forced palette, such as a Windows contrast theme.' },
    { name: 'inverted-colors', values: ['none', 'inverted'], mdn: true, flag: true,
      hint: 'OS color inversion. Behind the experimental flag in Chrome.' },
    { name: 'prefers-bold-text', values: ['no-preference', 'bold'], mdn: false,
      hint: 'Bold text setting. New in the spec; not in Chrome.' },
  ];

  const state = {};   // name -> { supported, value }
  const rows = {};    // name -> { valueCell }

  // Every known feature matches exactly one of its values. Unknown features
  // evaluate as "unknown" (false) for every value, so none match.
  function isRecognized(f) {
    return f.values.some((v) => window.matchMedia(`(${f.name}: ${v})`).matches);
  }

  function currentValue(f) {
    for (const v of f.values) {
      if (window.matchMedia(`(${f.name}: ${v})`).matches) return v;
    }
    return null;
  }

  function valueChip(f, value) {
    if (!state[f.name].supported) return chip('not recognized', 'bad', 'cancel');
    const isDefault = value === f.values[0];
    return chip(value, isDefault ? '' : 'info', isDefault ? 'radio_button_unchecked' : 'radio_button_checked');
  }

  function buildTable() {
    const tbody = $('mq-rows');
    for (const f of FEATURES) {
      const supported = isRecognized(f);
      const value = supported ? currentValue(f) : null;
      state[f.name] = { supported, value };
      dbg.group(`${f.name}: ${supported ? value : 'not recognized'}`, {
        recognized: supported,
        matches: Object.fromEntries(f.values.map((v) => [v, window.matchMedia(`(${f.name}: ${v})`).matches])),
      });

      const tr = document.createElement('tr');
      tr.id = `mq-${f.name}`;
      const nameTd = document.createElement('td');
      nameTd.innerHTML = `<code>${f.name}</code><div class="row-hint">${f.hint}</div>`;
      const valueTd = document.createElement('td');
      valueTd.append(valueChip(f, value));
      const valuesTd = document.createElement('td');
      valuesTd.innerHTML = f.values.map((v) => `<code>${v}</code>`).join(', ');
      const supTd = document.createElement('td');
      supTd.append(supported ? chip('Yes', 'ok', 'check_circle')
        : f.flag ? chip('Behind flag', 'warn', 'flag', 'Enable chrome://flags/#enable-experimental-web-platform-features')
        : chip('No', 'bad', 'cancel'));
      const docsTd = document.createElement('td');
      docsTd.innerHTML = `<a href="${SPEC}${f.name}" target="_blank" rel="noopener">Spec</a>`
        + (f.mdn ? ` · <a href="${MDN}${f.name}" target="_blank" rel="noopener">MDN</a>` : '');
      tr.append(nameTd, valueTd, valuesTd, supTd, docsTd);
      tbody.append(tr);
      rows[f.name] = { valueTd, tr };
    }
  }

  function renderSupport() {
    const recognized = FEATURES.filter((f) => state[f.name].supported).length;
    $('support-row').replaceChildren(
      typeof window.matchMedia === 'function' ? chip('matchMedia() available', 'ok', 'check_circle')
                                              : chip('matchMedia() not available', 'bad', 'cancel'),
      chip(`${recognized} of ${FEATURES.length} features recognized`, recognized === FEATURES.length ? 'ok' : 'warn', 'checklist'),
      debugChip(),
    );
  }

  function snapshot() {
    return Object.fromEntries(FEATURES.map((f) => [f.name, state[f.name].supported ? state[f.name].value : 'not recognized']));
  }

  const log = createLog({
    api: 'User preference media queries',
    spec: 'https://drafts.csswg.org/mediaqueries-5/#mf-user-preferences',
    filePrefix: 'media-queries-log',
    snapshot,
    dbg,
  });

  function onChange(f, ev) {
    const before = state[f.name].value;
    const after = currentValue(f);
    dbg.group(`event: change ${ev.media} matches=${ev.matches}`, { event: ev, feature: f.name, before, after });
    if (before === after) return; // the paired value's list also fires; log once
    state[f.name].value = after;
    rows[f.name].valueTd.replaceChildren(valueChip(f, after));
    rows[f.name].tr.classList.remove('row-changed');
    void rows[f.name].tr.offsetWidth; // restart the highlight animation
    rows[f.name].tr.classList.add('row-changed');
    log.add('change', `${f.name}: ${before} \u2192 ${after}`);
  }

  function init() {
    buildTable();
    renderSupport();
    for (const f of FEATURES) {
      if (!state[f.name].supported) continue;
      for (const v of f.values) {
        window.matchMedia(`(${f.name}: ${v})`).addEventListener('change', (ev) => onChange(f, ev));
      }
    }
    log.add('initial', FEATURES.filter((f) => state[f.name].supported).map((f) => `${f.name}=${state[f.name].value}`).join(', '));
    mountSystemDiagnostics(dbg);
  }

  init();
})();
