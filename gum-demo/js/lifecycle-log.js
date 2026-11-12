// Lifecycle Activity Log: always-on diagnostic timeline, device inventory
// tracker, and Markdown bug-report formatter for Chromium issue triage.

import { LIGHT_MODE, debugLog, escapeHtml } from './util.js';

export const lifecycleEvents = [];

// Latest full enumerateDevices() snapshot for Copy Log and Save Snapshot.
export let latestDeviceInventory = [];
let previousDeviceSignature = null;
let previousLabeledCounts = null;

// Cached navigator.userAgentData high-entropy values (exact Windows 10 vs 11
// build, CPU architecture/bitness, and full Chrome version).
export let highEntropyEnv = null;

function omitDeviceIds(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  const copy = structuredClone(obj);
  delete copy.deviceId;
  delete copy.groupId;
  if (copy.audio && typeof copy.audio === 'object') {
    delete copy.audio.deviceId;
    delete copy.audio.groupId;
  }
  return copy;
}

/**
 * Formats JSON with 2-space indentation while keeping primitive arrays and
 * short leaf objects (e.g. { "max": 2, "min": 1 }) on a single line.
 */
function formatCompactJson(value, indent = 0) {
  const pad = ' '.repeat(indent);
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    if (value.every(v => v === null || typeof v !== 'object')) {
      return `[${value.map(v => JSON.stringify(v)).join(', ')}]`;
    }
    const items = value.map(v => `${' '.repeat(indent + 2)}${formatCompactJson(v, indent + 2)}`);
    return `[\n${items.join(',\n')}\n${pad}]`;
  }
  const entries = Object.entries(value).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return '{}';
  const allPrimitive = entries.every(([, v]) => v === null || typeof v !== 'object');
  if (allPrimitive && indent > 0) {
    const inline = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(', ')} }`;
    if (inline.length <= 88) return inline;
  }
  const innerPad = ' '.repeat(indent + 2);
  const rows = entries.map(([k, v]) => `${innerPad}${JSON.stringify(k)}: ${formatCompactJson(v, indent + 2)}`);
  return `{\n${rows.join(',\n')}\n${pad}}`;
}

function updateSummaryBadge() {
  const badge = document.getElementById('summary-lifecycle-badge');
  if (!badge) return;
  const errors = lifecycleEvents.filter(e => e.level === 'error').length;
  const warnings = lifecycleEvents.filter(e => e.level === 'warning').length;
  if (errors > 0) {
    badge.textContent = `${errors} error${errors !== 1 ? 's' : ''}`;
    badge.className = 'lifecycle-summary-badge badge-error';
    badge.hidden = false;
  } else if (warnings > 0) {
    badge.textContent = `${warnings} warning${warnings !== 1 ? 's' : ''}`;
    badge.className = 'lifecycle-summary-badge badge-warning';
    badge.hidden = false;
  } else {
    badge.textContent = '';
    badge.className = 'lifecycle-summary-badge';
    badge.hidden = true;
  }
}

/**
 * Appends an event to the Lifecycle Activity Log.
 * @param {string} category
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} [level='info']
 * @param {Object|null} [data=null] Optional structured diagnostic details.
 */
export function logLifecycleEvent(category, message, level = 'info', data = null) {
  if (LIGHT_MODE) return;
  const now = new Date();
  const tMs = Math.round(performance.now() * 10) / 10;
  const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
  const relSec = `+${(tMs / 1000).toFixed(3)}s`;
  const entry = {
    seq: lifecycleEvents.length + 1,
    tMs,
    relSec,
    isoTime: now.toISOString(),
    time: timeStr,
    category,
    message,
    level,
  };
  if (data !== null && data !== undefined) {
    entry.data = data;
  }
  lifecycleEvents.push(entry);

  const logContainer = document.getElementById('lifecycle-events-log');
  const countSpan = document.getElementById('lifecycle-events-count');

  if (countSpan) {
    countSpan.textContent = `${lifecycleEvents.length} event${lifecycleEvents.length !== 1 ? 's' : ''}`;
  }
  updateSummaryBadge();

  if (logContainer) {
    const line = document.createElement('div');
    line.className = `lifecycle-event-line event-${level}`;

    let marker = '';
    if (level === 'error') marker = '<span class="event-marker">⛔</span>';
    else if (level === 'warning') marker = '<span class="event-marker">⚠️</span>';
    else if (level === 'success') marker = '<span class="event-marker">✅</span>';

    let detailHtml = '';
    if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      const compact = JSON.stringify(data);
      detailHtml = ` <span class="event-data">${escapeHtml(compact)}</span>`;
    }

    line.innerHTML =
        `${marker}<span class="event-timestamp">[${timeStr} ${relSec}]</span> ` +
        `<strong>${escapeHtml(category)}:</strong> ${escapeHtml(message)}${detailHtml}`;
    logContainer.appendChild(line);
    logContainer.scrollTop = logContainer.scrollHeight;
  }
  debugLog(`[Lifecycle] [${level.toUpperCase()}] ${timeStr} (${relSec}) [${category}] ${message}`, data || '');
}

/**
 * Collects Chromium Client Hints high-entropy platform details when supported.
 * Distinguishes Windows 11 (platformVersion major >= 13) from Windows 10, which
 * otherwise share "Windows NT 10.0" in navigator.userAgent.
 */
export async function collectHighEntropyEnv() {
  if (highEntropyEnv) return highEntropyEnv;
  if (!navigator.userAgentData || typeof navigator.userAgentData.getHighEntropyValues !== 'function') {
    return null;
  }
  try {
    const hints = await navigator.userAgentData.getHighEntropyValues([
      'architecture',
      'bitness',
      'fullVersionList',
      'model',
      'platform',
      'platformVersion',
      'uaFullVersion',
    ]);
    let osDetail = hints.platform || '';
    if (hints.platform === 'Windows' && hints.platformVersion) {
      const major = parseInt(hints.platformVersion.split('.')[0], 10);
      if (!Number.isNaN(major) && major > 0) {
        osDetail = `${major >= 13 ? 'Windows 11' : 'Windows 10'} (platformVersion ${hints.platformVersion})`;
      }
    } else if (hints.platformVersion) {
      osDetail = `${hints.platform} ${hints.platformVersion}`;
    }
    const arch = [hints.architecture, hints.bitness ? `${hints.bitness}-bit` : ''].filter(Boolean).join(' ');
    const fullBrands = Array.isArray(hints.fullVersionList)
        ? hints.fullVersionList
            .filter(b => b.brand && !/Not.?A.?Brand/i.test(b.brand))
            .map(b => `${b.brand} ${b.version}`)
            .join(', ')
        : '';
    highEntropyEnv = {
      osDetail: [osDetail, arch].filter(Boolean).join(', '),
      fullBrands: fullBrands || hints.uaFullVersion || '',
      raw: hints,
    };
    return highEntropyEnv;
  } catch (err) {
    debugLog('getHighEntropyValues failed:', err);
    return null;
  }
}

/**
 * Records an enumerateDevices() result, updates latestDeviceInventory (omitting
 * deviceId and groupId), and logs either the initial device inventory or
 * changes since the previous call.
 * @param {MediaDeviceInfo[]} devices
 * @param {number} durationMs
 * @param {string} reason
 */
export function recordEnumeratedDevices(devices, durationMs, reason) {
  if (LIGHT_MODE) return;
  const inventory = devices.map((d, idx) => ({
    index: idx,
    kind: d.kind,
    label: d.label || '',
  }));
  latestDeviceInventory = inventory;

  const byKind = (kind) => inventory.filter(d => d.kind === kind);
  const ai = byKind('audioinput');
  const ao = byKind('audiooutput');
  const vi = byKind('videoinput');

  const labeledCounts = {
    ai: ai.filter(d => d.label).length,
    ao: ao.filter(d => d.label).length,
    vi: vi.filter(d => d.label).length,
  };
  const rawAi = devices.filter(d => d.kind === 'audioinput');
  const hasDefaultMic = rawAi.some(d => d.deviceId === 'default');
  const hasCommMic = rawAi.some(d => d.deviceId === 'communications');

  const signature = JSON.stringify(inventory);
  const summaryMsg =
      `audioinput=${ai.length} (${labeledCounts.ai} labeled` +
      `${hasDefaultMic ? ', default' : ''}${hasCommMic ? ', communications' : ''}), ` +
      `audiooutput=${ao.length} (${labeledCounts.ao} labeled), ` +
      `videoinput=${vi.length} (${labeledCounts.vi} labeled) [${durationMs.toFixed(1)} ms]`;

  if (previousDeviceSignature === null) {
    const level = ai.length === 0 ? 'warning' : 'info';
    const prefix = ai.length === 0
        ? `No audioinput devices found (${reason}) — `
        : `Initial (${reason}): `;
    logLifecycleEvent('enumerateDevices', prefix + summaryMsg, level, {
      audioinput: ai.map(d => d.label || '(unlabeled)'),
    });
  } else if (signature !== previousDeviceSignature || reason === 'devicechange') {
    const labelsUnlocked = previousLabeledCounts &&
        previousLabeledCounts.ai === 0 && labeledCounts.ai > 0;
    const prefix = labelsUnlocked
        ? `Labels unlocked (${reason}): `
        : `Updated (${reason}): `;
    const level = ai.length === 0 ? 'warning' : 'info';
    logLifecycleEvent('enumerateDevices', prefix + summaryMsg, level, {
      audioinput: ai.map(d => d.label || '(unlabeled)'),
    });
  }

  previousDeviceSignature = signature;
  previousLabeledCounts = labeledCounts;
}

/**
 * Formats a self-contained Markdown report suitable for pasting directly into a
 * g-issues.chromium.org comment (omitting deviceId and groupId).
 */
export function formatDiagnosticMarkdownReport({
  systemDiagnostics = {},
  permissions = {},
  selectedConstraints = {},
  trackConstraints = null,
  trackSettings = null,
  trackCapabilities = null,
  trackProperties = null,
  trackStats = null,
  signalHealth = null,
} = {}) {
  const nowIso = new Date().toISOString();
  const errorCount = lifecycleEvents.filter(e => e.level === 'error').length;
  const warnCount = lifecycleEvents.filter(e => e.level === 'warning').length;
  const statusTag = errorCount > 0
      ? `${errorCount} error(s)`
      : (warnCount > 0 ? `${warnCount} warning(s)` : 'ok');

  const lines = [];
  lines.push(`<details>`);
  lines.push(`<summary>gum-demo diagnostic report (${nowIso}, ${statusTag})</summary>`);
  lines.push('');
  lines.push('### Environment & Permissions');
  lines.push('```text');
  lines.push(`Timestamp:            ${nowIso}`);
  lines.push(`Page URL:             ${window.location.href}`);
  lines.push(`Secure Context:       ${window.isSecureContext}`);
  lines.push(`Visibility / Focus:   visibilityState=${document.visibilityState}, hasFocus=${document.hasFocus()}`);
  lines.push(`Browser (UA):         ${systemDiagnostics['Browser'] || 'Unknown'}`);
  if (highEntropyEnv && highEntropyEnv.fullBrands) {
    lines.push(`Client Hints Brands:  ${highEntropyEnv.fullBrands}`);
  }
  if (highEntropyEnv && highEntropyEnv.osDetail) {
    lines.push(`OS (Client Hints):    ${highEntropyEnv.osDetail}`);
  }
  lines.push(`User Agent:           ${navigator.userAgent}`);
  lines.push(`System Resources:     cores=${navigator.hardwareConcurrency || 'N/A'}, memoryGB=${navigator.deviceMemory || 'N/A'}`);
  lines.push(`Mic Permission:       ${permissions.microphone || 'Unknown'}`);
  lines.push(`Camera Permission:    ${permissions.camera || 'Unknown'}`);
  if (permissions.permissionsPolicy) {
    lines.push(`Permissions Policy:   ${permissions.permissionsPolicy}`);
  }
  if (systemDiagnostics['Hardware Audio']) {
    const hw = systemDiagnostics['Hardware Audio'];
    lines.push(`AudioContext Probe:   sampleRate=${hw['Native Sample Rate']}, baseLatency=${hw['Base Latency']}, outputLatency=${hw['Output Latency']}, renderQuantum=${hw['Render Quantum']}`);
  }
  lines.push('```');
  lines.push('');

  lines.push(`### Enumerated Media Devices (${latestDeviceInventory.length})`);
  lines.push('```text');
  if (latestDeviceInventory.length === 0) {
    lines.push('(no devices enumerated)');
  } else {
    lines.push('idx  kind          label');
    lines.push('---  ------------  ------------------------------');
    for (const d of latestDeviceInventory) {
      const idx = String(d.index).padEnd(3);
      const kind = d.kind.padEnd(12);
      const lbl = d.label || '(empty - permission not granted or unlabeled)';
      lines.push(`${idx}  ${kind}  ${lbl}`);
    }
  }
  lines.push('```');
  lines.push('');

  lines.push('### Capture & Track State');
  lines.push('```json');
  const captureDump = {
    selectedConstraints: omitDeviceIds(selectedConstraints),
  };
  if (signalHealth) captureDump.signalHealthProbe = signalHealth;
  if (trackProperties) captureDump.trackProperties = trackProperties;
  if (trackConstraints) captureDump.trackGetConstraints = omitDeviceIds(trackConstraints);
  if (trackSettings) captureDump.trackGetSettings = omitDeviceIds(trackSettings);
  if (trackCapabilities) captureDump.trackGetCapabilities = omitDeviceIds(trackCapabilities);
  if (trackStats) captureDump.trackStats = trackStats;
  lines.push(formatCompactJson(captureDump));
  lines.push('```');
  lines.push('');

  lines.push(`### Lifecycle Activity Log (${lifecycleEvents.length} events)`);
  lines.push('```text');
  for (const e of lifecycleEvents) {
    const lvl = e.level.toUpperCase().padEnd(7);
    const base = `[${e.time} ${e.relSec.padStart(9)}] [${lvl}] [${e.category}] ${e.message}`;
    if (e.data && Object.keys(e.data).length > 0) {
      lines.push(`${base} | ${JSON.stringify(e.data)}`);
    } else {
      lines.push(base);
    }
  }
  lines.push('```');
  lines.push('</details>');
  return lines.join('\n') + '\n';
}
