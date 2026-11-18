// Audio output session demo.
//
// Opens audio output streams in chosen combinations of output device and
// playback path, and keeps a timestamped action log so that each action can
// be matched to Chrome's WASAPI log lines (LogAudioSessionVolumes).

const $ = (id) => document.getElementById(id);

const TONE_DURATION_SEC = 2;      // Looped, so the length only affects memory.
const TONE_PEAK = 0.25;           // Linear peak of the generated sine.
const MAX_PLAYERS = 4;
// Wait time after which a new Create & play opened a new output stream in
// tests on Windows (about 3.5 s reused the old stream, about 20 s did not).
const REOPEN_WAIT_SEC = 20;
const LOG_STORAGE_KEY = 'audio-session-demo.log';
const RUN_STORAGE_KEY = 'audio-session-demo.run';

const PATH_LABELS = {
  'html': '<audio> element',
  'webaudio-playback': 'Web Audio (playback)',
  'webaudio-interactive': 'Web Audio (interactive)',
  'webrtc': 'WebRTC loopback',
};

const state = {
  devices: [],            // MediaDeviceInfo[] of kind 'audiooutput'.
  labelsGranted: false,
  players: [],
  nextPlayerId: 1,
  log: [],
  browserLabel: 'Browser',
  osLabel: 'Unknown OS',
};

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

// Same format as the chrome_debug.log prefix: MMDD/HHMMSS.mmm (local time).
function chromeTime(d = new Date()) {
  return `${pad(d.getMonth() + 1)}${pad(d.getDate())}/` +
         `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.` +
         `${pad(d.getMilliseconds(), 3)}`;
}

let toastTimer = null;
function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

function showAlert(msg) {
  const banner = $('alert-banner');
  if (!msg) {
    banner.hidden = true;
    return;
  }
  $('alert-text').textContent = msg;
  banner.hidden = false;
}

function shortId(id) {
  if (!id) return '(empty)';
  if (id === 'default' || id === 'communications') return id;
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function deviceLabel(deviceId) {
  const d = state.devices.find(x => x.deviceId === deviceId);
  if (!d) return deviceId || 'default';
  return d.label || `(no label) ${shortId(deviceId)}`;
}

function encodeWav(samples, sampleRate) {
  const numFrames = samples.length;
  const buffer = new ArrayBuffer(44 + numFrames * 4);
  const view = new DataView(buffer);
  const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * 4, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);            // PCM
  view.setUint16(22, 2, true);            // Stereo
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, numFrames * 4, true);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    const v = Math.max(-1, Math.min(1, samples[i])) * 0x7fff;
    view.setInt16(off, v, true);
    view.setInt16(off + 2, v, true);
    off += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

const toneUrlCache = new Map();
function toneUrl(freq) {
  if (toneUrlCache.has(freq)) return toneUrlCache.get(freq);
  const sampleRate = 48000;
  const n = sampleRate * TONE_DURATION_SEC;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = TONE_PEAK * Math.sin(2 * Math.PI * freq * i / sampleRate);
  const url = URL.createObjectURL(encodeWav(samples, sampleRate));
  toneUrlCache.set(freq, url);
  return url;
}

// AudioContext uses '' for the default device; 'default' is not accepted.
function contextSinkId(deviceId) {
  return deviceId === 'default' ? '' : deviceId;
}

// ---------------------------------------------------------------------------
// Action log
// ---------------------------------------------------------------------------

function saveLog() {
  try {
    localStorage.setItem(LOG_STORAGE_KEY, JSON.stringify(state.log));
  } catch (e) { /* storage full or disabled: keep in memory only */ }
}

function loadLog() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOG_STORAGE_KEY) || '[]');
    if (Array.isArray(saved)) state.log = saved;
  } catch (e) {
    state.log = [];
  }
}

function logAction(player, action, details = '', time = new Date()) {
  state.log.push({
    index: state.log.length + 1,
    time: chromeTime(time),
    player: player ? `P${player.id}` : '—',
    action,
    path: player ? PATH_LABELS[player.path] : '',
    device: player ? `${deviceLabel(player.deviceId)} [${shortId(player.deviceId)}]` : '',
    details,
  });
  saveLog();
  renderLog();
}

function renderLog() {
  const tbody = $('log-tbody');
  if (state.log.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-table-msg">No actions yet.</td></tr>';
    return;
  }
  tbody.innerHTML = '';
  for (const e of state.log) {
    const tr = document.createElement('tr');
    for (const val of [e.index, e.time, e.player, e.action, e.path, e.device, e.details]) {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

// ---------------------------------------------------------------------------
// Devices
// ---------------------------------------------------------------------------

async function loadDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) {
    showAlert('navigator.mediaDevices.enumerateDevices() is not available.');
    return;
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  // Without permission Chrome hides labels and may return an entry with an
  // empty deviceId; treat that as the default device.
  state.devices = all.filter(d => d.kind === 'audiooutput').map(d => ({
    deviceId: d.deviceId || 'default',
    label: d.label || (d.deviceId ? '' : 'Default (names hidden)'),
    groupId: d.groupId,
  }));
  if (state.devices.length === 0) {
    state.devices = [{ deviceId: 'default', label: 'Default', groupId: '' }];
  }
  renderDevices();
  for (const p of state.players) fillDeviceSelect(p);
}

function renderDevices() {
  const tbody = $('devices-tbody');
  tbody.innerHTML = '';
  for (const d of state.devices) {
    const tr = document.createElement('tr');
    for (const val of [d.label || '(no label)', d.deviceId || '(empty)', d.groupId || '']) {
      const td = document.createElement('td');
      td.textContent = val;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  const chip = $('devices-chip');
  chip.textContent = `${state.devices.length} output device(s)${state.labelsGranted ? '' : ', no names'}`;
  chip.className = `tonal-chip ${state.labelsGranted ? 'success' : 'neutral'}`;
}

async function grantLabels() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    state.labelsGranted = true;
    showAlert('');
    await loadDevices();
    logAction(null, 'Device names loaded', `${state.devices.length} output devices`);
  } catch (e) {
    showAlert(`Microphone permission is needed for device names: ${e.name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

function fillDeviceSelect(p) {
  const sel = p.el.querySelector('.player-device');
  const previous = sel.value || p.deviceId;
  sel.innerHTML = '';
  for (const d of state.devices) {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = `${d.label || '(no label)'} [${shortId(d.deviceId)}]`;
    sel.appendChild(opt);
  }
  if (state.devices.some(d => d.deviceId === previous)) sel.value = previous;
}

function setStatus(p, text, kind) {
  const chip = p.el.querySelector('.player-status');
  chip.textContent = text;
  chip.className = `tonal-chip ${kind} player-status`;
}

function updateButtons(p) {
  const q = (s) => p.el.querySelector(s);
  const exists = p.playing !== null;
  q('.act-create').disabled = exists;
  q('.act-pause').disabled = !exists || !p.playing;
  q('.act-resume').disabled = !exists || p.playing;
  q('.act-switch').disabled = !exists;
  q('.act-destroy').disabled = !exists;
  q('.player-path').disabled = exists;
  q('.player-freq').disabled = exists;
}

function updateSinkText(p, sinkId) {
  p.el.querySelector('.player-sink').textContent =
    `sinkId: ${sinkId === undefined ? '—' : (sinkId === '' ? '(empty = default)' : sinkId)}`;
}

function applyVolume(p) {
  const v = Number(p.el.querySelector('.player-volume').value);
  p.el.querySelector('.player-volume-value').textContent = v.toFixed(2);
  if (p.audioEl) p.audioEl.volume = v;
  if (p.gain) p.gain.gain.value = v;
}

// Shows a countdown on the player card after Destroy or Switch device.
function startCountdown(p, kind, deviceText) {
  stopCountdown(p);
  p.countdown = { kind, deviceText, start: Date.now() };
  const box = p.el.querySelector('.player-countdown');
  const text = p.el.querySelector('.player-countdown-text');
  box.hidden = false;
  const tick = () => {
    const left = REOPEN_WAIT_SEC - (Date.now() - p.countdown.start) / 1000;
    if (left > 0) {
      box.classList.remove('ready');
      text.textContent = kind === 'destroy'
        ? `${Math.ceil(left)} s: Create & play now may reuse the previous output stream (no new log line).`
        : `${Math.ceil(left)} s: switching back to ${deviceText} now may reuse its previous stream (no new log line).`;
    } else {
      box.classList.add('ready');
      text.textContent = kind === 'destroy'
        ? 'Ready: Create & play should open a new output stream (new log line).'
        : `Ready: switching back to ${deviceText} should open a new stream (new log line).`;
      clearInterval(p.countdownTimer);
      p.countdownTimer = null;
    }
  };
  tick();
  p.countdownTimer = setInterval(tick, 250);
}

function stopCountdown(p) {
  if (p.countdownTimer) clearInterval(p.countdownTimer);
  p.countdownTimer = null;
  p.countdown = null;
  p.el.querySelector('.player-countdown').hidden = true;
}

// Seconds since the last Destroy, or null.
function secondsSinceDestroy(p) {
  if (!p.countdown || p.countdown.kind !== 'destroy') return null;
  return (Date.now() - p.countdown.start) / 1000;
}

async function createPlayer(p) {
  // Log the time of the click: Chrome may open streams before the awaits
  // below have finished.
  const clickTime = new Date();
  const sinceDestroy = secondsSinceDestroy(p);
  stopCountdown(p);
  p.path = p.el.querySelector('.player-path').value;
  p.freq = Number(p.el.querySelector('.player-freq').value);
  p.deviceId = p.el.querySelector('.player-device').value || 'default';
  const vol = Number(p.el.querySelector('.player-volume').value);

  try {
    if (p.path === 'html') {
      const audio = new Audio();
      audio.loop = true;
      audio.src = toneUrl(p.freq);
      audio.volume = vol;
      await audio.setSinkId(p.deviceId);
      await audio.play();
      p.audioEl = audio;
      updateSinkText(p, audio.sinkId);
    } else if (p.path.startsWith('webaudio')) {
      const latencyHint = p.path === 'webaudio-playback' ? 'playback' : 'interactive';
      const ctx = new AudioContext({ latencyHint, sinkId: contextSinkId(p.deviceId) });
      const osc = new OscillatorNode(ctx, { frequency: p.freq });
      const gain = new GainNode(ctx, { gain: vol });
      osc.connect(gain).connect(ctx.destination);
      osc.start();
      await ctx.resume();
      p.ctx = ctx;
      p.gain = gain;
      updateSinkText(p, typeof ctx.sinkId === 'string' ? ctx.sinkId : 'n/a');
    } else if (p.path === 'webrtc') {
      await createWebRtcPlayer(p, vol);
    }
    p.playing = true;
    setStatus(p, 'Playing', 'active');
    const gap = sinceDestroy === null ? ''
      : `, ${sinceDestroy.toFixed(1)} s after Destroy${sinceDestroy < REOPEN_WAIT_SEC ? ' (stream may be reused)' : ''}`;
    logAction(p, 'Create & play', `${p.freq} Hz, page volume ${vol.toFixed(2)}${gap}`, clickTime);
  } catch (e) {
    await destroyResources(p);
    p.playing = null;
    setStatus(p, 'Error', 'error');
    logAction(p, 'Create failed', `${e.name}: ${e.message}`, clickTime);
    showAlert(`P${p.id}: ${e.name}: ${e.message}`);
  }
  updateButtons(p);
}

// Local RTCPeerConnection pair: an oscillator is sent from pc1 to pc2, and
// the remote track is played in an <audio> element with the chosen sink.
async function createWebRtcPlayer(p, vol) {
  // The source context only feeds the peer connection. sinkId {type: 'none'}
  // keeps it from opening an output stream of its own, so that only the
  // WebRTC playout stream shows up in Chrome's log.
  let srcCtx;
  try {
    srcCtx = new AudioContext({ sinkId: { type: 'none' } });
  } catch (e) {
    srcCtx = new AudioContext();
  }
  const osc = new OscillatorNode(srcCtx, { frequency: p.freq });
  const gain = new GainNode(srcCtx, { gain: TONE_PEAK });
  const dest = srcCtx.createMediaStreamDestination();
  osc.connect(gain).connect(dest);
  osc.start();

  const pc1 = new RTCPeerConnection();
  const pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
  pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
  const remoteTrack = new Promise((resolve) => {
    pc2.ontrack = (e) => resolve(e.streams[0] || new MediaStream([e.track]));
  });
  dest.stream.getTracks().forEach(t => pc1.addTrack(t, dest.stream));

  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);

  const stream = await remoteTrack;
  const audio = new Audio();
  audio.srcObject = stream;
  audio.volume = vol;
  await audio.setSinkId(p.deviceId);
  await audio.play();

  p.rtc = { srcCtx, pc1, pc2 };
  p.audioEl = audio;
  updateSinkText(p, audio.sinkId);
}

async function pausePlayer(p) {
  if (p.audioEl) p.audioEl.pause();
  if (p.ctx) await p.ctx.suspend();
  p.playing = false;
  setStatus(p, 'Paused', 'warning');
  logAction(p, 'Pause');
  updateButtons(p);
}

async function resumePlayer(p) {
  try {
    if (p.audioEl) await p.audioEl.play();
    if (p.ctx) await p.ctx.resume();
    p.playing = true;
    setStatus(p, 'Playing', 'active');
    logAction(p, 'Resume');
  } catch (e) {
    logAction(p, 'Resume failed', `${e.name}: ${e.message}`);
  }
  updateButtons(p);
}

async function switchDevice(p) {
  const newId = p.el.querySelector('.player-device').value || 'default';
  const oldLabel = `${deviceLabel(p.deviceId)} [${shortId(p.deviceId)}]`;
  try {
    if (p.audioEl) {
      await p.audioEl.setSinkId(newId);
      updateSinkText(p, p.audioEl.sinkId);
    } else if (p.ctx) {
      await p.ctx.setSinkId(contextSinkId(newId));
      updateSinkText(p, p.ctx.sinkId);
    }
    p.deviceId = newId;
    logAction(p, 'Switch device', `from ${oldLabel}`);
    startCountdown(p, 'switch', oldLabel);
  } catch (e) {
    logAction(p, 'Switch failed', `${e.name}: ${e.message}`);
    showAlert(`P${p.id}: ${e.name}: ${e.message}`);
  }
}

async function destroyResources(p) {
  if (p.audioEl) {
    p.audioEl.pause();
    p.audioEl.srcObject = null;
    p.audioEl.removeAttribute('src');
    p.audioEl.load();
    p.audioEl = null;
  }
  if (p.ctx) {
    await p.ctx.close().catch(() => {});
    p.ctx = null;
    p.gain = null;
  }
  if (p.rtc) {
    p.rtc.pc1.close();
    p.rtc.pc2.close();
    await p.rtc.srcCtx.close().catch(() => {});
    p.rtc = null;
  }
}

async function destroyPlayer(p) {
  await destroyResources(p);
  p.playing = null;
  setStatus(p, 'Idle', 'neutral');
  updateSinkText(p, undefined);
  logAction(p, 'Destroy');
  startCountdown(p, 'destroy');
  updateButtons(p);
}

function addPlayer() {
  if (state.players.length >= MAX_PLAYERS) {
    showToast(`At most ${MAX_PLAYERS} players`);
    return;
  }
  const el = $('player-template').content.firstElementChild.cloneNode(true);
  const p = {
    id: state.nextPlayerId++,
    el,
    path: 'html',
    freq: 440,
    deviceId: 'default',
    playing: null,        // null = no player, true = playing, false = paused.
    audioEl: null,
    ctx: null,
    gain: null,
    rtc: null,
    countdown: null,
    countdownTimer: null,
  };
  el.querySelector('.player-title').textContent = `Player ${p.id}`;
  const freqs = ['330', '440', '550', '660'];
  el.querySelector('.player-freq').value = freqs[(p.id - 1) % freqs.length];

  // Unique ids so that labels are associated with their controls.
  for (const cls of ['player-device', 'player-path', 'player-freq', 'player-volume']) {
    const control = el.querySelector(`.${cls}`);
    control.id = `${cls}-${p.id}`;
    const label = control.closest('.field-row').querySelector('label');
    label.htmlFor = control.id;
  }

  el.querySelector('.act-create').addEventListener('click', () => createPlayer(p));
  el.querySelector('.act-pause').addEventListener('click', () => pausePlayer(p));
  el.querySelector('.act-resume').addEventListener('click', () => resumePlayer(p));
  el.querySelector('.act-switch').addEventListener('click', () => switchDevice(p));
  el.querySelector('.act-destroy').addEventListener('click', () => destroyPlayer(p));
  el.querySelector('.act-remove').addEventListener('click', async () => {
    if (p.playing !== null) await destroyPlayer(p);
    stopCountdown(p);
    el.remove();
    state.players = state.players.filter(x => x !== p);
  });
  el.querySelector('.player-volume').addEventListener('input', () => applyVolume(p));
  el.querySelector('.player-volume').addEventListener('change', () => {
    if (p.playing !== null) logAction(p, 'Page volume', Number(el.querySelector('.player-volume').value).toFixed(2));
  });

  $('players').appendChild(el);
  state.players.push(p);
  fillDeviceSelect(p);
  updateButtons(p);
}

// ---------------------------------------------------------------------------
// Report, environment, theme
// ---------------------------------------------------------------------------

async function copyReport() {
  const lines = [
    '### Audio output session demo report',
    `- **Browser**: ${state.browserLabel}`,
    `- **OS**: ${state.osLabel}`,
    '',
    '**Output devices**',
    '',
    '| Label | deviceId |',
    '|:---|:---|',
    ...state.devices.map(d => `| ${d.label || '(no label)'} | \`${d.deviceId || '(empty)'}\` |`),
    '',
    '**Action log** (Chrome time = `MMDD/HHMMSS.mmm`, local)',
    '',
    '| # | Chrome time | Player | Action | Path | Device | Details |',
    '|---:|:---|:---|:---|:---|:---|:---|',
    ...state.log.map(e => `| ${e.index} | \`${e.time}\` | ${e.player} | ${e.action} | ${e.path} | ${e.device} | ${e.details} |`),
  ];
  await navigator.clipboard.writeText(lines.join('\n'));
  showToast('Markdown report copied');
}

async function initEnvironmentInfo() {
  const uaMatch = navigator.userAgent.match(/(Edg|OPR|Chrome|Firefox|Safari)\/([\d.]+)/);
  state.browserLabel = uaMatch ? `${uaMatch[1] === 'Edg' ? 'Edge' : uaMatch[1]} ${uaMatch[2]}` : 'Browser';
  if (/Win/i.test(navigator.userAgent)) state.osLabel = 'Windows';
  else if (/Mac/i.test(navigator.userAgent)) state.osLabel = 'macOS';
  else if (/Linux/i.test(navigator.userAgent)) state.osLabel = 'Linux';
  if (navigator.userAgentData) {
    try {
      const ua = await navigator.userAgentData.getHighEntropyValues(['fullVersionList', 'platformVersion']);
      const brand = (ua.fullVersionList || []).find(b => /Chrome|Chromium|Edge/.test(b.brand));
      if (brand) state.browserLabel = `${brand.brand} ${brand.version}`;
      if (ua.platformVersion) state.osLabel += ` (${ua.platformVersion})`;
    } catch (e) { /* keep UA-based labels */ }
  }
  const badge = $('env-badge');
  badge.textContent = `${state.browserLabel} · ${state.osLabel}`;
  badge.className = 'tonal-chip neutral';
}

function initThemeToggle() {
  const root = document.documentElement;
  const key = 'audio-session-demo.theme';
  const saved = localStorage.getItem(key);
  if (saved === 'light' || saved === 'dark') root.dataset.theme = saved;
  const isDark = () => root.dataset.theme === 'dark' ||
    (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const syncIcon = () => { $('theme-icon').textContent = isDark() ? 'light_mode' : 'dark_mode'; };
  syncIcon();
  $('theme-toggle-btn').addEventListener('click', () => {
    root.dataset.theme = isDark() ? 'light' : 'dark';
    localStorage.setItem(key, root.dataset.theme);
    syncIcon();
  });
}

function init() {
  initThemeToggle();
  initEnvironmentInfo();

  $('grant-labels-btn').addEventListener('click', grantLabels);
  $('refresh-devices-btn').addEventListener('click', loadDevices);
  $('add-player-btn').addEventListener('click', addPlayer);
  $('clear-log-btn').addEventListener('click', () => {
    state.log = [];
    localStorage.setItem(RUN_STORAGE_KEY, '1');
    saveLog();
    renderLog();
    logAction(null, 'Log cleared (run 1)', 'new log started');
  });
  $('copy-report-btn').addEventListener('click', copyReport);
  $('copy-cmd-btn').addEventListener('click', async () => {
    await navigator.clipboard.writeText($('ps-cmd').textContent);
    showToast('PowerShell command copied');
  });

  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      loadDevices();
      logAction(null, 'devicechange event');
    });
  }

  // The action log is kept across reloads and browser restarts (same
  // profile), so that a test spanning a restart ends up in one report.
  loadLog();
  const run = state.log.length === 0
    ? 1
    : Number(localStorage.getItem(RUN_STORAGE_KEY) || '1') + 1;
  localStorage.setItem(RUN_STORAGE_KEY, String(run));
  logAction(null, `Page loaded (run ${run})`, state.browserLabel === 'Browser' ? '' : state.browserLabel);

  loadDevices().catch(e => showAlert(`${e.name}: ${e.message}`));
  addPlayer();
  addPlayer();
}

init();
