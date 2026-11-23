// Far-end audio (echo source) player for gum-demo.
//
// Modeled on audio-session-demo (single player) and uses the looped .wav files
// from ../echo-demo/audio/ (or a local audio file) so Chrome opens an active
// output render stream (EchoCanceller3 reverse stream) alongside getUserMedia.
// Runs zero timers, zero requestAnimationFrame loops, and zero idle
// AudioContexts so ?light CPU profiles stay completely clean.

import { createSilentAudioContext, debugLog } from './util.js';
import { insertStereoSupportForOpus } from './sdp.js';
import { logLifecycleEvent } from './lifecycle-log.js';

export const ECHO_DEMO_WAV_FILES = [
  'concatenate_female.wav',
  'harvard.wav',
  'female_lead_voice_music.wav',
  'cyndi_lauper_48k.wav',
  'music_beat.wav',
  'left_right_stereo_test.wav',
  'stereo_knocking.wav',
];

const LOCAL_FILE_VALUE = '__local__';
const DEFAULT_WAV_FILE = ECHO_DEMO_WAV_FILES[0];
const DEFAULT_PATH = 'html';
const DEFAULT_VOLUME = 0.6;

const PATH_LABELS = {
  'html': '<audio> element',
  'webaudio-playback': 'Web Audio (playback)',
  'webaudio-interactive': 'Web Audio (interactive)',
  'webrtc': 'WebRTC loopback',
};

const mediaElementSetSinkIdSupported =
    typeof HTMLMediaElement !== 'undefined' && ('setSinkId' in HTMLMediaElement.prototype);
const audioContextSetSinkIdSupported =
    typeof AudioContext !== 'undefined' && ('setSinkId' in AudioContext.prototype);

// Cache fetched ArrayBuffers by URL so recreating or switching WebAudio/WebRTC
// paths does not re-download the WAV file.
const rawWavCache = new Map();

const state = {
  devices: [],          // Normalized audiooutput entries { value, label, rawId }.
  hasDeviceLabels: false,
  desiredSinkId: '',    // Preserves URL-requested sinkId until devices load.
  path: DEFAULT_PATH,
  fileValue: DEFAULT_WAV_FILE,
  localBlobUrl: null,
  localFileName: '',
  deviceId: '',
  playing: null,        // null = idle/destroyed, true = playing, false = paused.
  busy: false,          // True while Create & play is awaiting decode/play.
  audioEl: null,
  ctx: null,
  sourceNode: null,
  gain: null,
  rtc: null,
  activeSinkId: undefined,
  onUnlockDevices: null,
  onError: null,
};

function shortId(id) {
  if (!id) return 'default';
  if (id === 'default' || id === 'communications') return id;
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

function contextSinkId(deviceId) {
  // AudioContext uses '' for the default device; 'default' is not accepted.
  return (!deviceId || deviceId === 'default') ? '' : deviceId;
}

function getElements() {
  return {
    details: document.getElementById('far-end-details'),
    badge: document.getElementById('farend-status-badge'),
    deviceSelect: document.getElementById('farend-device'),
    unlockBtn: document.getElementById('farend-unlock-btn'),
    pathSelect: document.getElementById('farend-path'),
    fileSelect: document.getElementById('farend-file'),
    localRow: document.getElementById('farend-local-row'),
    localInput: document.getElementById('farend-local-input'),
    volumeInput: document.getElementById('farend-volume'),
    volumeValue: document.getElementById('farend-volume-value'),
    createBtn: document.getElementById('farend-create-btn'),
    pauseBtn: document.getElementById('farend-pause-btn'),
    resumeBtn: document.getElementById('farend-resume-btn'),
    switchBtn: document.getElementById('farend-switch-btn'),
    destroyBtn: document.getElementById('farend-destroy-btn'),
    sinkInfo: document.getElementById('farend-sink-info'),
  };
}

function resolveWavSource() {
  const { fileSelect, localInput } = getElements();
  const selected = fileSelect ? fileSelect.value : DEFAULT_WAV_FILE;
  if (selected === LOCAL_FILE_VALUE) {
    if (!state.localBlobUrl && localInput && localInput.files && localInput.files[0]) {
      const f = localInput.files[0];
      state.localBlobUrl = URL.createObjectURL(f);
      state.localFileName = f.name;
    }
    if (!state.localBlobUrl) {
      throw new Error('Select a local audio file first.');
    }
    return {
      url: state.localBlobUrl,
      label: state.localFileName || 'local file',
      cacheable: false,
    };
  }
  const file = ECHO_DEMO_WAV_FILES.includes(selected) ? selected : DEFAULT_WAV_FILE;
  return {
    url: new URL(`../echo-demo/audio/${file}`, window.location.href).href,
    label: file,
    cacheable: true,
  };
}

async function fetchDecodedAudioBuffer(ctx, wavSource) {
  let rawBuffer = wavSource.cacheable ? rawWavCache.get(wavSource.url) : null;
  if (!rawBuffer) {
    const resp = await fetch(wavSource.url);
    if (!resp.ok) {
      throw new Error(`Failed to load ${wavSource.label} (HTTP ${resp.status})`);
    }
    rawBuffer = await resp.arrayBuffer();
    if (wavSource.cacheable) {
      rawWavCache.set(wavSource.url, rawBuffer);
    }
  }
  // decodeAudioData detaches its input ArrayBuffer, so pass a slice copy.
  return ctx.decodeAudioData(rawBuffer.slice(0));
}

function deviceSummary(deviceId) {
  const match = state.devices.find(d => d.value === deviceId);
  if (!match) return deviceId || 'default';
  return `${match.label} [${shortId(match.value)}]`;
}

function setStatus(text, kind) {
  const { badge } = getElements();
  if (!badge) return;
  badge.textContent = text;
  badge.dataset.state = kind;
}

function updateSinkText(sinkId) {
  state.activeSinkId = sinkId;
  const { sinkInfo } = getElements();
  if (!sinkInfo) return;
  if (sinkId === undefined) {
    sinkInfo.textContent = 'sinkId: —';
  } else if (sinkId === '') {
    sinkInfo.textContent = 'sinkId: (empty = default)';
  } else {
    sinkInfo.textContent = `sinkId: ${sinkId}`;
  }
}

function updateButtons() {
  const {
    pathSelect,
    fileSelect,
    localInput,
    deviceSelect,
    createBtn,
    pauseBtn,
    resumeBtn,
    switchBtn,
    destroyBtn,
  } = getElements();
  if (!createBtn) return;
  const exists = state.playing !== null;
  const sinkSupported = state.path.startsWith('webaudio')
      ? audioContextSetSinkIdSupported
      : mediaElementSetSinkIdSupported;

  createBtn.disabled = state.busy || exists;
  pauseBtn.disabled = state.busy || !exists || !state.playing;
  resumeBtn.disabled = state.busy || !exists || state.playing;
  switchBtn.disabled = state.busy || !exists || !sinkSupported;
  destroyBtn.disabled = state.busy || !exists;
  if (pathSelect) pathSelect.disabled = state.busy || exists;
  if (fileSelect) fileSelect.disabled = state.busy || exists;
  if (localInput) localInput.disabled = state.busy || exists;
  if (deviceSelect) deviceSelect.disabled = state.busy || !sinkSupported;
}

function syncLocalRowVisibility() {
  const { fileSelect, localRow } = getElements();
  if (!fileSelect || !localRow) return;
  localRow.hidden = fileSelect.value !== LOCAL_FILE_VALUE;
}

function applyVolume() {
  const { volumeInput, volumeValue } = getElements();
  if (!volumeInput) return;
  const v = Number(volumeInput.value);
  if (volumeValue) volumeValue.textContent = v.toFixed(2);
  if (state.audioEl) state.audioEl.volume = v;
  if (state.gain) state.gain.gain.value = v;
}

function reportError(prefix, err) {
  const msg = err && err.name ? `${err.name}: ${err.message}` : String(err);
  debugLog(`[Far-End Audio] ${prefix}: ${msg}`);
  logLifecycleEvent('Far-End Audio', `${prefix} — ${msg}`, 'error');
  if (typeof state.onError === 'function') {
    state.onError(`Far-end audio: ${msg}`);
  }
}

function clearErrorIfShown() {
  if (typeof state.onError === 'function') {
    state.onError('');
  }
}

async function destroyResources() {
  if (state.sourceNode) {
    try {
      state.sourceNode.stop();
      state.sourceNode.disconnect();
    } catch {}
    state.sourceNode = null;
  }
  if (state.audioEl) {
    try {
      state.audioEl.pause();
      state.audioEl.srcObject = null;
      state.audioEl.removeAttribute('src');
      state.audioEl.load();
    } catch {}
    state.audioEl = null;
  }
  if (state.ctx) {
    await state.ctx.close().catch(() => {});
    state.ctx = null;
    state.gain = null;
  }
  if (state.rtc) {
    try { state.rtc.pc1.close(); } catch {}
    try { state.rtc.pc2.close(); } catch {}
    await state.rtc.srcCtx.close().catch(() => {});
    state.rtc = null;
  }
}

async function createWebRtcPlayer(wavSource, deviceId, vol) {
  const srcCtx = createSilentAudioContext();
  const decoded = await fetchDecodedAudioBuffer(srcCtx, wavSource);
  const bufSource = new AudioBufferSourceNode(srcCtx, { buffer: decoded, loop: true });
  const dest = srcCtx.createMediaStreamDestination();
  bufSource.connect(dest);
  bufSource.start();
  if (srcCtx.state === 'suspended') {
    await srcCtx.resume();
  }

  const pc1 = new RTCPeerConnection();
  const pc2 = new RTCPeerConnection();
  pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
  pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
  const remoteStreamPromise = new Promise((resolve) => {
    pc2.ontrack = (e) => resolve(e.streams[0] || new MediaStream([e.track]));
  });
  dest.stream.getTracks().forEach(t => pc1.addTrack(t, dest.stream));

  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  const answer = await pc2.createAnswer();
  answer.sdp = insertStereoSupportForOpus(answer.sdp);
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);

  const remoteStream = await remoteStreamPromise;
  const audio = new Audio();
  audio.srcObject = remoteStream;
  audio.volume = vol;
  if (mediaElementSetSinkIdSupported && deviceId !== '') {
    await audio.setSinkId(deviceId);
  }
  await audio.play();

  state.rtc = { srcCtx, pc1, pc2 };
  state.sourceNode = bufSource;
  state.audioEl = audio;
  updateSinkText(mediaElementSetSinkIdSupported ? audio.sinkId : undefined);
}

async function createPlayer() {
  const { pathSelect, fileSelect, deviceSelect, volumeInput } = getElements();
  if (state.busy || state.playing !== null) return;
  clearErrorIfShown();

  state.busy = true;
  state.path = pathSelect ? pathSelect.value : DEFAULT_PATH;
  state.fileValue = fileSelect ? fileSelect.value : DEFAULT_WAV_FILE;
  state.deviceId = deviceSelect ? deviceSelect.value : '';
  const vol = volumeInput ? Number(volumeInput.value) : DEFAULT_VOLUME;
  updateButtons();

  try {
    const wavSource = resolveWavSource();
    if (state.path === 'html') {
      const audio = new Audio();
      audio.loop = true;
      audio.preload = 'auto';
      audio.src = wavSource.url;
      audio.volume = vol;
      if (mediaElementSetSinkIdSupported && state.deviceId !== '') {
        await audio.setSinkId(state.deviceId);
      }
      await audio.play();
      state.audioEl = audio;
      updateSinkText(mediaElementSetSinkIdSupported ? audio.sinkId : undefined);
    } else if (state.path.startsWith('webaudio')) {
      const latencyHint = state.path === 'webaudio-playback' ? 'playback' : 'interactive';
      const ctxOpts = { latencyHint };
      if (audioContextSetSinkIdSupported) {
        ctxOpts.sinkId = contextSinkId(state.deviceId);
      }
      const ctx = new AudioContext(ctxOpts);
      const decoded = await fetchDecodedAudioBuffer(ctx, wavSource);
      const bufSource = new AudioBufferSourceNode(ctx, { buffer: decoded, loop: true });
      const gain = new GainNode(ctx, { gain: vol });
      bufSource.connect(gain).connect(ctx.destination);
      bufSource.start();
      await ctx.resume();
      state.ctx = ctx;
      state.sourceNode = bufSource;
      state.gain = gain;
      updateSinkText(typeof ctx.sinkId === 'string' ? ctx.sinkId : undefined);
    } else if (state.path === 'webrtc') {
      await createWebRtcPlayer(wavSource, state.deviceId, vol);
    }

    state.playing = true;
    setStatus(`Playing · ${wavSource.label}`, 'playing');
    logLifecycleEvent(
        'Far-End Audio',
        `Create & play: ${wavSource.label} via ${PATH_LABELS[state.path]}, device=${deviceSummary(state.deviceId)}, volume=${vol.toFixed(2)}`,
        'success');
  } catch (err) {
    await destroyResources();
    state.playing = null;
    setStatus('Error', 'error');
    reportError('Create & play failed', err);
  } finally {
    state.busy = false;
    updateButtons();
  }
}

async function pausePlayer() {
  if (state.playing !== true) return;
  if (state.audioEl) state.audioEl.pause();
  if (state.ctx) await state.ctx.suspend();
  if (state.rtc?.srcCtx) await state.rtc.srcCtx.suspend();
  state.playing = false;
  setStatus('Paused', 'paused');
  logLifecycleEvent('Far-End Audio', 'Pause');
  updateButtons();
}

async function resumePlayer() {
  if (state.playing !== false) return;
  clearErrorIfShown();
  try {
    if (state.rtc?.srcCtx) await state.rtc.srcCtx.resume();
    if (state.audioEl) await state.audioEl.play();
    if (state.ctx) await state.ctx.resume();
    const label = state.fileValue === LOCAL_FILE_VALUE
        ? (state.localFileName || 'local file')
        : state.fileValue;
    state.playing = true;
    setStatus(`Playing · ${label}`, 'playing');
    logLifecycleEvent('Far-End Audio', 'Resume', 'success');
  } catch (err) {
    reportError('Resume failed', err);
  }
  updateButtons();
}

async function switchDevice() {
  if (state.playing === null) return;
  clearErrorIfShown();
  const { deviceSelect } = getElements();
  const newId = deviceSelect ? deviceSelect.value : '';
  const oldSummary = deviceSummary(state.deviceId);
  try {
    if (state.audioEl && mediaElementSetSinkIdSupported) {
      await state.audioEl.setSinkId(newId);
      updateSinkText(state.audioEl.sinkId);
    } else if (state.ctx && audioContextSetSinkIdSupported) {
      await state.ctx.setSinkId(contextSinkId(newId));
      updateSinkText(typeof state.ctx.sinkId === 'string' ? state.ctx.sinkId : undefined);
    }
    state.deviceId = newId;
    logLifecycleEvent('Far-End Audio', `Switch device: ${oldSummary} -> ${deviceSummary(newId)}`);
  } catch (err) {
    reportError('Switch device failed', err);
  }
}

async function destroyPlayer() {
  await destroyResources();
  state.playing = null;
  setStatus('Idle', 'idle');
  updateSinkText(undefined);
  logLifecycleEvent('Far-End Audio', 'Destroy');
  updateButtons();
}

/**
 * Updates the Far-End output device dropdown from an enumerateDevices() list.
 * Safe both before permission is granted (when Chrome returns a single entry
 * with empty deviceId/label) and after labels are unlocked.
 * @param {MediaDeviceInfo[]} allDevices
 */
export function populateFarEndDevices(allDevices = []) {
  const { deviceSelect, unlockBtn } = getElements();
  if (!deviceSelect) return;

  const rawOutputs = allDevices.filter(d => d.kind === 'audiooutput');
  const hasLabels = rawOutputs.some(d => Boolean(d.label));
  state.hasDeviceLabels = hasLabels;

  if (rawOutputs.length === 0) {
    state.devices = [{ value: '', label: 'Default', rawId: '' }];
  } else {
    state.devices = rawOutputs.map((d, idx) => {
      // Before mic permission is granted, deviceId is '' (not 'default'); keep
      // '' so setSinkId() does not reject with NotFoundError.
      const value = d.deviceId || '';
      const label = d.label || (value ? `Speaker ${idx + 1}` : 'Default (names hidden)');
      return { value, label, rawId: d.deviceId };
    });
  }

  const previous = state.desiredSinkId || deviceSelect.value || '';
  deviceSelect.innerHTML = '';
  for (const d of state.devices) {
    const opt = new Option(`${d.label} [${shortId(d.value)}]`, d.value);
    deviceSelect.appendChild(opt);
  }

  if (state.devices.some(d => d.value === previous)) {
    deviceSelect.value = previous;
    state.desiredSinkId = '';
  } else if (previous === 'default' && state.devices.some(d => d.value === '')) {
    deviceSelect.value = '';
  }

  if (unlockBtn) {
    unlockBtn.hidden = hasLabels;
  }
  updateButtons();
}

/** Applies optional far-end URL parameters (?farEndOpen=1, ?farEndFile=..., etc.). */
export function applyFarEndUrlParams(params) {
  const { details, fileSelect, pathSelect, volumeInput, deviceSelect } = getElements();
  if (!details) return;

  if (params.has('farEndFile') && fileSelect) {
    const requested = params.get('farEndFile');
    if (ECHO_DEMO_WAV_FILES.includes(requested)) {
      fileSelect.value = requested;
      state.fileValue = requested;
      syncLocalRowVisibility();
    }
  }
  if (params.has('farEndPath') && pathSelect) {
    const requested = params.get('farEndPath');
    if (requested in PATH_LABELS) {
      pathSelect.value = requested;
      state.path = requested;
      updateButtons();
    }
  }
  if (params.has('farEndVolume') && volumeInput) {
    const num = Number(params.get('farEndVolume'));
    if (!Number.isNaN(num) && num >= 0 && num <= 1) {
      volumeInput.value = String(num);
      applyVolume();
    }
  }
  if (params.has('farEndSinkId') && deviceSelect) {
    const sink = params.get('farEndSinkId');
    state.desiredSinkId = sink;
    if ([...deviceSelect.options].some(o => o.value === sink)) {
      deviceSelect.value = sink;
      state.desiredSinkId = '';
    }
  }
  const openParam = params.get('farEndOpen');
  if (openParam === '1' || openParam === 'true') {
    details.open = true;
  }
}

/** Appends non-default far-end settings to URLSearchParams for Copy Bookmark / Light mode links. */
export function appendFarEndBookmarkParams(params) {
  const { details, fileSelect, pathSelect, volumeInput, deviceSelect } = getElements();
  if (!details) return;

  if (details.open) {
    params.set('farEndOpen', '1');
  }
  if (fileSelect && fileSelect.value !== DEFAULT_WAV_FILE && fileSelect.value !== LOCAL_FILE_VALUE) {
    params.set('farEndFile', fileSelect.value);
  }
  if (pathSelect && pathSelect.value !== DEFAULT_PATH) {
    params.set('farEndPath', pathSelect.value);
  }
  if (volumeInput && Math.abs(Number(volumeInput.value) - DEFAULT_VOLUME) > 1e-6) {
    params.set('farEndVolume', Number(volumeInput.value).toFixed(2));
  }
  if (deviceSelect && deviceSelect.value && deviceSelect.value !== '' && deviceSelect.value !== 'default') {
    params.set('farEndSinkId', deviceSelect.value);
  }
}

/** Structured summary for Save Snapshot and Copy Log (null when idle at defaults). */
export function getFarEndSnapshot({ omitIds = false } = {}) {
  const { fileSelect, pathSelect, volumeInput, deviceSelect } = getElements();
  if (!fileSelect) return null;
  if (state.playing === null) return null;

  const selectedFile = fileSelect.value === LOCAL_FILE_VALUE
      ? (state.localFileName || 'local file')
      : fileSelect.value;
  const activeId = state.deviceId || (deviceSelect ? deviceSelect.value : '');
  const matchedDevice = state.devices.find(d => d.value === activeId);
  const snap = {
    state: state.playing ? 'playing' : 'paused',
    file: selectedFile,
    playbackPath: PATH_LABELS[state.path] || (pathSelect ? pathSelect.value : DEFAULT_PATH),
    pageVolume: volumeInput ? Number(Number(volumeInput.value).toFixed(2)) : DEFAULT_VOLUME,
    outputDeviceLabel: matchedDevice ? matchedDevice.label : 'Default',
  };
  if (!omitIds) {
    snap.sinkId = state.activeSinkId === '' ? '' : (state.activeSinkId || 'default');
  }
  return snap;
}

export function initFarEndPlayer({ onUnlockDevices = null, onError = null } = {}) {
  state.onUnlockDevices = onUnlockDevices;
  state.onError = onError;

  const {
    fileSelect,
    localInput,
    pathSelect,
    volumeInput,
    unlockBtn,
    createBtn,
    pauseBtn,
    resumeBtn,
    switchBtn,
    destroyBtn,
  } = getElements();
  if (!fileSelect || !createBtn) return;

  fileSelect.innerHTML = '';
  for (const file of ECHO_DEMO_WAV_FILES) {
    fileSelect.appendChild(new Option(file, file));
  }
  fileSelect.appendChild(new Option('Local file...', LOCAL_FILE_VALUE));
  fileSelect.value = DEFAULT_WAV_FILE;
  syncLocalRowVisibility();

  fileSelect.addEventListener('change', () => {
    state.fileValue = fileSelect.value;
    syncLocalRowVisibility();
  });

  if (localInput) {
    localInput.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (state.localBlobUrl) {
        URL.revokeObjectURL(state.localBlobUrl);
      }
      state.localBlobUrl = URL.createObjectURL(file);
      state.localFileName = file.name;
    });
  }

  if (pathSelect) {
    pathSelect.addEventListener('change', () => {
      state.path = pathSelect.value;
      updateButtons();
    });
  }

  if (volumeInput) {
    applyVolume();
    volumeInput.addEventListener('input', applyVolume);
    volumeInput.addEventListener('change', () => {
      if (state.playing !== null) {
        logLifecycleEvent('Far-End Audio', `Page volume: ${Number(volumeInput.value).toFixed(2)}`);
      }
    });
  }

  if (unlockBtn) {
    unlockBtn.addEventListener('click', async () => {
      if (typeof state.onUnlockDevices === 'function') {
        unlockBtn.disabled = true;
        try {
          await state.onUnlockDevices();
        } finally {
          unlockBtn.disabled = false;
        }
      }
    });
  }

  createBtn.addEventListener('click', createPlayer);
  pauseBtn.addEventListener('click', pausePlayer);
  resumeBtn.addEventListener('click', resumePlayer);
  switchBtn.addEventListener('click', switchDevice);
  destroyBtn.addEventListener('click', destroyPlayer);

  setStatus('Idle', 'idle');
  updateSinkText(undefined);
  updateButtons();
}
