// gdm-demo: getDisplayMedia() audio test page.
//
// Builds a DisplayMediaStreamOptions object from the controls, calls
// getDisplayMedia(), and shows the audio track's getConstraints(),
// getSettings(), getCapabilities() and properties. The audio track
// feeds a level meter and can be recorded with MediaRecorder.

import { initTooltipA11y, labelInfoIcons } from './a11y.js';
import { logLifecycleEvent } from './lifecycle-log.js';
import { getAudioHardwareInfo, getBrowserInfo, getOSInfo } from './sysinfo.js';
import { debugLog, escapeHtml } from './util.js';
import {
  hasRecordedLevelMeter, startRecordedLevelMeter, stopRecordedLevelMeter,
  stopVisualizer, visualizeAudio,
} from './visualizer.js';

// ---------- Elements ----------
const $ = (id) => document.getElementById(id);
const gdmButton = $('gdm-button');
const stopButton = $('stop-button');
const recordButton = $('record-button');
const muteCheckbox = $('mute-checkbox');
const errorMessage = $('error-message');
const streamControls = $('stream-controls-container');
const requestPreview = $('request-preview');
const trackConstraintsEl = $('track-constraints');
const trackSettingsEl = $('track-settings');
const trackCapabilitiesEl = $('track-capabilities');
const trackPropertiesEl = $('track-properties');
const recordedContainer = $('recorded-audio-container');
const recordedAudio = $('recorded-audio');
const recordedVisualizer = $('recorded-visualizer');
const downloadButton = $('download-recorded-audio-button');

// Top-level DisplayMediaStreamOptions members (string or boolean values).
const OPTION_IDS = ['systemAudio', 'windowAudio', 'selfBrowserSurface',
  'surfaceSwitching', 'monitorTypeSurfaces', 'preferCurrentTab'];
// Audio constraints shown in the "audio" block.
const AUDIO_CONSTRAINT_IDS = ['restrictOwnAudio', 'suppressLocalAudioPlayback',
  'echoCancellation', 'autoGainControl', 'noiseSuppression', 'channelCount',
  'sampleRate', 'sampleSize'];
// Constraint names listed under "Supported Constraints" in diagnostics.
const SUPPORTED_CONSTRAINT_NAMES = ['restrictOwnAudio', 'suppressLocalAudioPlayback',
  'echoCancellation', 'autoGainControl', 'noiseSuppression', 'voiceIsolation',
  'channelCount', 'sampleRate', 'sampleSize', 'latency', 'displaySurface'];
const STORAGE_KEY = 'gdm-demo.selections';

// ---------- State ----------
let stream = null;
let audioTrack = null;
let propertiesInterval = null;
let previousProperties = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordedMimeType = '';
let recordedAudioGraph = null;

// ---------- Controls ----------

/** Fills each constraint <select> with undefined / plain / ideal / exact. */
function populateConstraintSelects() {
  for (const id of AUDIO_CONSTRAINT_IDS) {
    const select = $(id);
    const values = select.dataset.values ? select.dataset.values.split(',') : ['true', 'false'];
    const group = (label, prefix) =>
      `<optgroup label="${label}">${values.map(v =>
        `<option value="${prefix}${v}">${prefix ? prefix.replace(':', ': ') : ''}${v}</option>`).join('')}</optgroup>`;
    select.innerHTML = '<option value="undefined" selected>undefined</option>' +
      group('Plain (= ideal)', '') +
      group('Ideal', 'ideal:') +
      group('Exact (TypeError expected)', 'exact:');
  }
}

function parseScalar(text) {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && !Number.isNaN(Number(text))) return Number(text);
  return text;
}

/** Converts a select value to a constraint value, or undefined. */
function parseConstraintValue(value) {
  if (value === 'undefined') return undefined;
  if (value.startsWith('ideal:')) return { ideal: parseScalar(value.slice(6)) };
  if (value.startsWith('exact:')) return { exact: parseScalar(value.slice(6)) };
  return parseScalar(value);
}

/** Builds the DisplayMediaStreamOptions object from the controls. */
function buildOptions() {
  const options = {};
  const video = {};
  const displaySurface = $('displaySurface').value;
  if (displaySurface !== 'undefined') video.displaySurface = displaySurface;
  options.video = Object.keys(video).length ? video : true;

  const audio = {};
  for (const id of AUDIO_CONSTRAINT_IDS) {
    const v = parseConstraintValue($(id).value);
    if (v !== undefined) audio[id] = v;
  }
  options.audio = Object.keys(audio).length ? audio : true;

  for (const id of OPTION_IDS) {
    const select = $(id);
    if (select.value === 'undefined') continue;
    options[id] = select.dataset.kind === 'value' ? parseScalar(select.value) : select.value;
  }
  return options;
}

function updateRequestPreview() {
  requestPreview.textContent =
    'navigator.mediaDevices.getDisplayMedia(\n' +
    JSON.stringify(buildOptions(), null, 2).replace(/^/gm, '  ') + '\n);';
}

function allSelects() {
  return [...OPTION_IDS, 'displaySurface', ...AUDIO_CONSTRAINT_IDS].map($);
}

function saveSelections() {
  const state = {};
  for (const select of allSelects()) state[select.id] = select.value;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
}

function restoreSelections() {
  let state = {};
  try { state = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { /* ignore */ }
  for (const select of allSelects()) {
    const v = state[select.id];
    if (v !== undefined && [...select.options].some(o => o.value === v)) select.value = v;
  }
}

// ---------- Bookmark (URL parameters) ----------
// Parameter names are the control ids (for example ?restrictOwnAudio=ideal:true
// &systemAudio=include). The Local Audio file is stored as ?audioFile=<name>.
// URL parameters override the selections saved in localStorage.

const copyBookmarkButton = $('copy-bookmark-button');
const bookmarkUrlContainer = $('bookmark-url-container');

function buildBookmarkUrl() {
  const params = new URLSearchParams();
  for (const select of allSelects()) {
    if (select.value !== 'undefined') params.set(select.id, select.value);
  }
  for (const src of LOCAL_SOURCES) {
    const select = $(`${src.key}-audio-file`);
    if (!select.options[select.selectedIndex].defaultSelected) params.set(src.param, fileName(select.value));
  }
  const query = params.toString();
  return `${location.origin}${location.pathname}${query ? `?${query}` : ''}`;
}

function copyBookmark() {
  const url = buildBookmarkUrl();
  debugLog('Bookmark URL:', url);
  navigator.clipboard.writeText(url).then(() => {
    const originalText = copyBookmarkButton.textContent;
    copyBookmarkButton.textContent = 'Copied!';
    setTimeout(() => { copyBookmarkButton.textContent = originalText; }, 2000);
  }).catch(err => console.error('Failed to copy URL: ', err));

  bookmarkUrlContainer.textContent = 'Bookmark URL: ';
  const link = document.createElement('a');
  link.href = url;
  link.textContent = url;
  link.target = '_blank';
  bookmarkUrlContainer.appendChild(link);
  logLifecycleEvent('Bookmark', 'URL copied to the clipboard');
}

/**
 * Applies URL parameters to the controls. Returns the set of applied
 * parameter names.
 */
function applyUrlParameters() {
  const params = new URLSearchParams(location.search);
  const applied = new Set();
  for (const select of allSelects()) {
    const v = params.get(select.id);
    if (v !== null && [...select.options].some(o => o.value === v)) {
      select.value = v;
      applied.add(select.id);
    }
  }
  for (const src of LOCAL_SOURCES) {
    const name = params.get(src.param);
    if (!name) continue;
    const select = $(`${src.key}-audio-file`);
    const option = [...select.options].find(o => fileName(o.value) === name);
    if (option) {
      select.value = option.value;
      applied.add(src.param);
      try { localStorage.setItem(`gdm-demo.${src.key}AudioFile`, option.value); } catch { /* ignore */ }
    }
  }
  return applied;
}

// ---------- Messages ----------

function showError(text, notice = false) {
  errorMessage.textContent = text;
  errorMessage.classList.toggle('notice', notice);
  errorMessage.hidden = false;
}

function clearError() {
  errorMessage.textContent = '';
  errorMessage.hidden = true;
  errorMessage.classList.remove('notice');
}

let toastTimer = null;
function toast(text, ms = 3000) {
  const el = $('toast-notification');
  if (!el) return;
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// ---------- Track panes ----------

function formatInlineValue(value) {
  if (Array.isArray(value)) return `[${value.map(formatInlineValue).join(', ')}]`;
  if (value && typeof value === 'object') {
    const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${formatInlineValue(v)}`);
    return parts.length ? `{ ${parts.join(', ')} }` : '{}';
  }
  return JSON.stringify(value);
}

function shortId(id) {
  return typeof id === 'string' && id.length > 20 ? `${id.slice(0, 8)}..${id.slice(-8)}` : id;
}

/** Renders obj as one row per key; wrap(key, text) adds highlight markup. */
function renderRows(header, obj, keys, wrap = (k, t) => t) {
  const present = keys.filter(k => Object.prototype.hasOwnProperty.call(obj, k));
  if (!present.length) return `${header}\n{}`;
  const lines = present.map((k, i) => {
    const text = escapeHtml(`"${k}": ${formatInlineValue(obj[k])}${i === present.length - 1 ? '' : ','}`);
    return '  ' + wrap(k, text);
  });
  return `${header}\n{\n${lines.join('\n')}\n}`;
}

/** Sorted union of keys of the given objects, with deviceId/groupId last. */
function rowKeys(...objs) {
  const tail = ['deviceId', 'groupId'];
  const all = new Set(objs.flatMap(o => Object.keys(o)));
  return [...[...all].filter(k => !tail.includes(k)).sort(), ...tail.filter(k => all.has(k))];
}

/** 'applied' if getSettings() matches the requested value, else 'not-applied'. */
function constraintStatus(requested, settings) {
  const status = {};
  for (const [key, c] of Object.entries(requested)) {
    let target = c;
    if (c && typeof c === 'object') target = c.exact !== undefined ? c.exact : c.ideal;
    const actual = settings[key];
    const match = actual !== undefined &&
      (typeof target === 'number' && typeof actual === 'number'
        ? Math.abs(target - actual) < 0.0001 : actual === target);
    status[key] = match ? 'applied' : 'not-applied';
  }
  return status;
}

function fadeHighlights(el) {
  setTimeout(() => el.querySelectorAll('.highlight, .highlight-green, .highlight-red')
    .forEach(e => e.classList.add('fade-out')), 5000);
}

function updateGetters(track, requestedAudio) {
  const constraints = track.getConstraints ? track.getConstraints() : {};
  const settings = track.getSettings ? { ...track.getSettings() } : {};
  const capabilities = track.getCapabilities ? { ...track.getCapabilities() } : {};
  for (const obj of [settings, capabilities]) {
    if (obj.deviceId) obj.deviceId = shortId(obj.deviceId);
    if (obj.groupId) obj.groupId = shortId(obj.groupId);
  }
  const keys = rowKeys(constraints, settings);
  const requestedKeys = Object.keys(requestedAudio || {});
  const status = constraintStatus(requestedAudio || {}, settings);

  trackConstraintsEl.innerHTML = renderRows('getConstraints():', constraints, keys,
    (k, t) => requestedKeys.includes(k) ? `<span class="highlight">${t}</span>` : t);
  trackSettingsEl.innerHTML = renderRows('getSettings():', settings, keys, (k, t) => {
    if (status[k] === 'applied') return `<span class="highlight-green">${t}</span>`;
    if (status[k] === 'not-applied') return `<span class="highlight-red">${t}</span>`;
    return t;
  });
  trackCapabilitiesEl.innerHTML = renderRows('getCapabilities():', capabilities,
    rowKeys(capabilities), (k, t) => requestedKeys.includes(k) ? `<span class="highlight">${t}</span>` : t);
  [trackConstraintsEl, trackSettingsEl, trackCapabilitiesEl].forEach(fadeHighlights);
  debugLog('getConstraints', constraints, 'getSettings', settings, 'getCapabilities', capabilities);
}

function updateProperties(track) {
  const props = {
    id: track.id, kind: track.kind, label: track.label,
    enabled: track.enabled, muted: track.muted, readyState: track.readyState,
    contentHint: track.contentHint,
  };
  trackPropertiesEl.innerHTML = renderRows('properties:', props, Object.keys(props), (k, t) =>
    previousProperties && previousProperties[k] !== props[k] ? `<span class="highlight">${t}</span>` : t);
  fadeHighlights(trackPropertiesEl);
  previousProperties = props;
}

function clearTrackPanes() {
  for (const el of [trackConstraintsEl, trackSettingsEl, trackCapabilitiesEl,
    trackPropertiesEl]) el.textContent = '';
  previousProperties = null;
}

// ---------- getDisplayMedia ----------

async function startCapture() {
  clearError();
  if (stream) stopCapture();
  const options = buildOptions();
  logLifecycleEvent('getDisplayMedia', `Called with ${JSON.stringify(options)}`);
  let newStream;
  try {
    newStream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    console.error('getDisplayMedia error:', err);
    const msg = `${err.name}: ${err.message}`;
    showError(`getDisplayMedia() failed: ${msg}`);
    logLifecycleEvent('getDisplayMedia Error', msg, 'error');
    return;
  }

  const [videoTrack] = newStream.getVideoTracks();
  const [track] = newStream.getAudioTracks();
  if (!track) {
    newStream.getTracks().forEach(t => t.stop());
    showError('No audio track. Select a screen or tab and turn on audio sharing in the picker.', true);
    logLifecycleEvent('getDisplayMedia', 'No audio track was returned (audio not shared in the picker)', 'warning');
    return;
  }

  stream = newStream;
  audioTrack = track;
  logLifecycleEvent('getDisplayMedia', `Acquired audio track "${track.label || 'Audio track'}" (id: ${track.id.substring(0, 8)}..)`, 'success');

  // getDisplayMedia() requires video. This page only uses the audio track.
  if (videoTrack) videoTrack.stop();

  const requestedAudio = typeof options.audio === 'object' ? options.audio : {};
  updateGetters(track, requestedAudio);
  updateProperties(track);
  propertiesInterval = setInterval(() => updateProperties(track), 1000);

  track.onmute = () => {
    logLifecycleEvent('track.onmute', 'Audio track muted', 'warning');
    updateProperties(track);
  };
  track.onunmute = () => {
    logLifecycleEvent('track.onunmute', 'Audio track unmuted', 'success');
    updateProperties(track);
  };
  track.onended = () => {
    logLifecycleEvent('track.onended', 'Audio track ended (sharing stopped)', 'warning');
    updateProperties(track);
    stopCapture(/* fromEnded= */ true);
  };

  muteCheckbox.checked = !track.enabled;
  visualizeAudio(new MediaStream([track]));
  streamControls.hidden = false;
}

function stopCapture(fromEnded = false) {
  if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
  clearInterval(propertiesInterval);
  propertiesInterval = null;
  if (stream) {
    stream.getTracks().forEach(t => t.stop());
    if (!fromEnded) logLifecycleEvent('Stream', 'Stream stopped with MediaStreamTrack.stop()');
  }
  stopVisualizer();
  stream = null;
  audioTrack = null;
  streamControls.hidden = true;
  // Keep the last getter values visible after the stream ends.
}

// ---------- Recording ----------

function findSupportedMimeType() {
  for (const type of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return '';
}

function updateRecordButton() {
  const recording = mediaRecorder && mediaRecorder.state === 'recording';
  recordButton.classList.toggle('recording', !!recording);
  recordButton.innerHTML = `<span class="record-dot"></span>${recording ? 'Stop Rec' : 'Rec'}`;
}

function startRecording() {
  if (!audioTrack) return;
  const mimeType = findSupportedMimeType();
  recordedChunks = [];
  recordedContainer.hidden = true;
  stopRecordedLevelMeter(true);
  recordedVisualizer.hidden = true;
  if (recordedAudio.src) {
    URL.revokeObjectURL(recordedAudio.src);
    recordedAudio.removeAttribute('src');
  }
  try {
    mediaRecorder = new MediaRecorder(new MediaStream([audioTrack]), mimeType ? { mimeType } : {});
  } catch (err) {
    showError(`MediaRecorder Error: ${err.message}`);
    logLifecycleEvent('MediaRecorder Error', `Failed to start: ${err.message}`, 'error');
    return;
  }
  recordedMimeType = mediaRecorder.mimeType || mimeType || 'audio/webm';
  mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) recordedChunks.push(e.data); };
  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: recordedMimeType });
    recordedAudio.src = URL.createObjectURL(blob);
    recordedContainer.hidden = false;
    logLifecycleEvent('MediaRecorder', `Recording completed (${(blob.size / 1024).toFixed(1)} KB)`, 'success');
    updateRecordButton();
  };
  mediaRecorder.onerror = (e) => {
    logLifecycleEvent('MediaRecorder Error', `${e.error?.name}: ${e.error?.message || 'Unknown error'}`, 'error');
  };
  mediaRecorder.start();
  logLifecycleEvent('MediaRecorder', `Recording started (mimeType: ${recordedMimeType})`);
  toast('Recording started');
  updateRecordButton();
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') {
    mediaRecorder.stop();
    logLifecycleEvent('MediaRecorder', 'Stop recording requested');
  }
  updateRecordButton();
}

// Level meter for recorded playback. createMediaElementSource() can only be
// called once per element, so the graph is created on first play and reused.
function ensureRecordedAudioGraph() {
  if (recordedAudioGraph || !hasRecordedLevelMeter()) return recordedAudioGraph;
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const source = ctx.createMediaElementSource(recordedAudio);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  analyser.connect(ctx.destination);
  recordedAudioGraph = { ctx, analyser };
  return recordedAudioGraph;
}

recordedAudio.addEventListener('play', async () => {
  const graph = ensureRecordedAudioGraph();
  if (!graph) return;
  if (graph.ctx.state === 'suspended') await graph.ctx.resume();
  recordedVisualizer.hidden = false;
  startRecordedLevelMeter(graph.analyser);
});
recordedAudio.addEventListener('pause', () => stopRecordedLevelMeter());
recordedAudio.addEventListener('ended', () => stopRecordedLevelMeter(true));

downloadButton.addEventListener('click', () => {
  if (!recordedAudio.src) return;
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const ext = recordedMimeType.includes('ogg') ? 'ogg' : 'webm';
  const name = `gdm-recording-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.${ext}`;
  const a = document.createElement('a');
  a.href = recordedAudio.src;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  logLifecycleEvent('MediaRecorder', `Downloaded "${name}"`);
});

// ---------- Local audio sources ----------
// Three rows that play a file in this page in different ways (same as
// echo-demo). Independent of getDisplayMedia(), so they can be started and
// stopped at any time, and several can play at the same time.
//   html:     the <audio> element plays the file directly.
//   webaudio: createMediaElementSource() -> AudioContext.destination.
//   pc:       createMediaElementSource() -> MediaStreamDestination -> pc1 ->
//             pc2 (Opus, stereo) -> #pc-audio-sink plays the remote track.

const LOCAL_SOURCES = [
  { key: 'html', name: '<audio>', param: 'audioFile' },
  { key: 'webaudio', name: 'Web Audio', param: 'webAudioFile' },
  { key: 'pc', name: 'RTCPeerConnection', param: 'pcAudioFile' },
];
const pcAudioSink = $('pc-audio-sink');
let localAudioContext = null;
const elementSources = new Map();  // key -> MediaElementAudioSourceNode
let pc1 = null;
let pc2 = null;

function fileName(src) {
  return decodeURIComponent(src.split('/').pop());
}

function sourceEls(src) {
  return { audio: $(`${src.key}-audio`), select: $(`${src.key}-audio-file`) };
}

async function ensureAudioContext() {
  if (!localAudioContext) localAudioContext = new AudioContext();
  if (localAudioContext.state === 'suspended') await localAudioContext.resume();
  return localAudioContext;
}

/** Adds stereo=1 to the Opus fmtp line so that stereo files stay stereo. */
function enableOpusStereo(sdp) {
  return sdp.replace(/(a=fmtp:\d+ [^\r\n]*useinbandfec=1)(?![^\r\n]*stereo=1)/g, '$1;stereo=1');
}

async function startPeerConnectionLoopback(stream) {
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => { if (e.candidate) pc2.addIceCandidate(e.candidate).catch(() => {}); };
  pc2.onicecandidate = (e) => { if (e.candidate) pc1.addIceCandidate(e.candidate).catch(() => {}); };
  const remote = new Promise((resolve) => { pc2.ontrack = (e) => resolve(e.streams[0]); });
  for (const track of stream.getAudioTracks()) pc1.addTrack(track, stream);
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  answer.sdp = enableOpusStereo(answer.sdp);
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  pcAudioSink.srcObject = await remote;
  await pcAudioSink.play().catch(() => {});
}

/** Builds the Web Audio or RTCPeerConnection path the first time a row plays. */
async function setUpPlayoutPath(src, audio) {
  if (src.key === 'html' || elementSources.has(src.key)) return;
  const ctx = await ensureAudioContext();
  // After createMediaElementSource(), the element no longer plays out by
  // itself; its audio goes into the AudioContext graph instead.
  const node = ctx.createMediaElementSource(audio);
  elementSources.set(src.key, node);
  if (src.key === 'webaudio') {
    node.connect(ctx.destination);
    logLifecycleEvent('Local audio', 'Web Audio: MediaElementAudioSourceNode -> AudioContext.destination');
  } else {
    const dest = ctx.createMediaStreamDestination();
    node.connect(dest);
    await startPeerConnectionLoopback(dest.stream);
    logLifecycleEvent('Local audio', 'RTCPeerConnection: loopback pc1 -> pc2 connected, remote track plays in a hidden audio element');
  }
}

function initLocalAudio(fromUrl) {
  for (const src of LOCAL_SOURCES) {
    const { audio, select } = sourceEls(src);
    const storageKey = `gdm-demo.${src.key}AudioFile`;
    if (!fromUrl.has(src.param)) {
      try {
        // 'gdm-demo.localAudioFile' is the key from before there were 3 rows.
        const saved = localStorage.getItem(storageKey) ??
          (src.key === 'html' ? localStorage.getItem('gdm-demo.localAudioFile') : null);
        if (saved && [...select.options].some(o => o.value === saved)) select.value = saved;
      } catch { /* ignore */ }
    }
    audio.src = select.value;

    select.addEventListener('change', () => {
      const wasPlaying = !audio.paused;
      audio.src = select.value;
      if (wasPlaying) audio.play().catch(() => {});
      logLifecycleEvent('Local audio', `${src.name}: source set to "${fileName(select.value)}"`);
      try { localStorage.setItem(storageKey, select.value); } catch { /* ignore */ }
    });
    audio.addEventListener('play', async () => {
      try {
        await setUpPlayoutPath(src, audio);
        if (localAudioContext && src.key !== 'html') await localAudioContext.resume();
        logLifecycleEvent('Local audio', `${src.name}: playing "${fileName(audio.currentSrc || audio.src)}"`);
      } catch (e) {
        logLifecycleEvent('Local audio Error', `${src.name}: ${e.name}: ${e.message}`, 'error');
      }
    });
    audio.addEventListener('pause', () => logLifecycleEvent('Local audio', `${src.name}: paused`));
    audio.addEventListener('error', () => {
      const err = audio.error;
      logLifecycleEvent('Local audio Error', `${src.name}: could not play "${fileName(audio.src)}" (${err ? err.code : 'unknown'})`, 'error');
    });
  }
}

// ---------- System diagnostics ----------

let permissionStatusObject = null;

async function populateSystemInfo() {
  const infoDiv = $('system-info-details');
  const browser = getBrowserInfo();
  const os = getOSInfo();
  const md = navigator.mediaDevices;
  const gdmSupported = !!(md && md.getDisplayMedia);

  let permission = 'Unknown';
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const status = await navigator.permissions.query({ name: 'display-capture' });
      permission = status.state;
      if (!permissionStatusObject) {
        permissionStatusObject = status;
        status.addEventListener('change', () => {
          logLifecycleEvent('Permission', `display-capture changed to "${status.state}"`);
          populateSystemInfo();
        });
      }
    } catch (e) {
      permission = `Not queryable (${e.name})`;
    }
  }
  let permissionClass = 'status-warn';
  if (permission === 'granted') permissionClass = 'status-ok';
  if (permission === 'denied') permissionClass = 'status-bad';

  const { hwSampleRate, hwBaseLatency, hwOutputLatency, hwRenderQuantum } = getAudioHardwareInfo();

  const sup = md?.getSupportedConstraints?.() || {};
  const supHtml = SUPPORTED_CONSTRAINT_NAMES
    .map(n => `<span class="sup-key">${n}:${sup[n] ? '✅' : '❌'}</span>`).join('');

  const apis = {
    getDisplayMedia: gdmSupported,
    CaptureController: typeof CaptureController !== 'undefined',
    MediaRecorder: typeof MediaRecorder !== 'undefined',
    'Web Audio': !!(window.AudioContext || window.webkitAudioContext),
    getCapabilities: typeof MediaStreamTrack !== 'undefined' && 'getCapabilities' in MediaStreamTrack.prototype,
  };
  const apisHtml = Object.entries(apis).map(([k, v]) => `${k}:${v ? '✅' : '❌'}`).join(', ');

  infoDiv.innerHTML = `
    <strong>Browser:</strong> ${escapeHtml(browser.name)} ${escapeHtml(browser.version)} (${os})<br>
    <strong>Secure Context:</strong> ${window.isSecureContext ? '<span class="status-ok">Yes</span>' : '<span class="status-bad">No (getDisplayMedia will fail)</span>'}<br>
    <strong>Display-Capture Permission:</strong> <span class="${permissionClass}">${escapeHtml(permission)}</span>
    <span class="info-icon" tabindex="0" role="img" data-tooltip="navigator.permissions.query({name: 'display-capture'}). getDisplayMedia() normally asks every time, so this is usually 'prompt'. It is 'denied' if blocked by policy or the user.">i</span><br>
    <strong>Origin:</strong> ${escapeHtml(location.protocol)}//${escapeHtml(location.host)}<br>
    <strong>Hardware Audio:</strong> Sample Rate: ${hwSampleRate}, Base Latency: ${hwBaseLatency}, Output Latency: ${hwOutputLatency}, Render Quantum: ${hwRenderQuantum}<br>
    <strong>APIs Supported:</strong> ${apisHtml}<br>
    <strong>Supported Constraints:</strong>
    <span class="info-icon" tabindex="0" role="img" data-tooltip="navigator.mediaDevices.getSupportedConstraints(): the constraint names that the browser recognizes. It does not say if the platform supports the feature. Check getCapabilities() and getSettings() on the track after the request.">i</span>
    <span class="sup-list">${supHtml}</span>
    <details class="ua-details">
      <summary>Raw User Agent</summary>
      <pre>${escapeHtml(navigator.userAgent)}</pre>
    </details>`;
  labelInfoIcons(infoDiv);
}

// ---------- Wiring ----------

function init() {
  populateConstraintSelects();
  restoreSelections();
  const fromUrl = applyUrlParameters();
  if (fromUrl.size) saveSelections();
  initLocalAudio(fromUrl);
  updateRequestPreview();
  copyBookmarkButton.addEventListener('click', copyBookmark);
  for (const select of allSelects()) {
    select.addEventListener('change', () => { updateRequestPreview(); saveSelections(); });
  }

  gdmButton.addEventListener('click', startCapture);
  stopButton.addEventListener('click', () => stopCapture());
  recordButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') stopRecording();
    else startRecording();
  });
  muteCheckbox.addEventListener('change', () => {
    if (!audioTrack) return;
    audioTrack.enabled = !muteCheckbox.checked;
    logLifecycleEvent('track.enabled', `Track enabled set to ${audioTrack.enabled}`);
    updateProperties(audioTrack);
  });

  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    gdmButton.disabled = true;
    showError('navigator.mediaDevices.getDisplayMedia() is not available in this browser or context.');
  }
  initTooltipA11y();
  populateSystemInfo();
  logLifecycleEvent('Page', 'Loaded');
  if (fromUrl.size) logLifecycleEvent('Bookmark', `Applied ${fromUrl.size} setting(s) from the URL`);
}

init();
