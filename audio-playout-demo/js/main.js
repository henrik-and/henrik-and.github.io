// Minimal audio playout & WASAPI system loopback level diagnostic.
//
// Calibrated 440 Hz reference tone:
//   Peak = 10^(-12 / 20) = 0.251188643 (-12.0 dBFS peak, -15.01 dBFS RMS)

const REF_PEAK_DBFS = -12.0;
const REF_PEAK_LINEAR = Math.pow(10, REF_PEAK_DBFS / 20);
const TONE_FREQ_HZ = 440;
const TONE_DURATION_SEC = 4.0;

const $ = (id) => document.getElementById(id);

const state = {
  browserLabel: '',
  osLabel: '',
  hwInfo: {
    sampleRate: null,
    maxChannels: null,
    baseLatencyMs: null,
    outputLatencyMs: null,
  },
  playoutApi: 'html', // 'html' | 'webaudio'
  isPlaying: false,
  toneBlobUrl: null,
  playAudioCtx: null,
  playSourceNode: null,

  captureStream: null,
  meterCtx: null,
  meterWorklet: null,
  latestMetrics: null,
  isRecordingWav: false,
  wavChunksL: [],
  wavChunksR: [],
  wavTargetFrames: 0,
  wavCapturedFrames: 0,

  readings: [],
};

const WORKLET_CODE = `
class LevelAndRecorderProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.sumSqL = 0;
    this.sumSqR = 0;
    this.peak = 0;
    this.frames = 0;
    this.recording = false;
    this.port.onmessage = (e) => {
      if (e.data && typeof e.data.recording === 'boolean') {
        this.recording = e.data.recording;
      }
    };
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const chL = input[0];
    const chR = input.length > 1 ? input[1] : input[0];
    const len = chL.length;

    for (let i = 0; i < len; i++) {
      const sL = chL[i];
      const sR = chR[i];
      this.sumSqL += sL * sL;
      this.sumSqR += sR * sR;
      const absMax = Math.max(Math.abs(sL), Math.abs(sR));
      if (absMax > this.peak) this.peak = absMax;
    }
    this.frames += len;

    if (this.recording) {
      this.port.postMessage({
        type: 'pcm',
        left: chL.slice(),
        right: chR.slice(),
      });
    }

    if (this.frames >= sampleRate * 0.2) {
      this.port.postMessage({
        type: 'level',
        rmsL: Math.sqrt(this.sumSqL / this.frames),
        rmsR: Math.sqrt(this.sumSqR / this.frames),
        peak: this.peak,
      });
      this.sumSqL = 0;
      this.sumSqR = 0;
      this.peak = 0;
      this.frames = 0;
    }
    // Outputs remain 0.0 so connecting to destination pulls frames silently.
    return true;
  }
}
registerProcessor('level-and-recorder', LevelAndRecorderProcessor);
`;

function linearToDbfs(val) {
  if (!val || val <= 1e-7) return -Infinity;
  return 20 * Math.log10(val);
}

function formatDbfs(db) {
  if (!Number.isFinite(db) || db <= -120) return '-\u221e dBFS';
  return `${db.toFixed(1)} dBFS`;
}

function dbfsToPercent(db) {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
}

function encodeStereoWav16(leftSamples, rightSamples, sampleRate) {
  const numFrames = leftSamples.length;
  const numChannels = 2;
  const bytesPerSample = 2;
  const dataBytes = numFrames * numChannels * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  const writeAscii = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    const l = Math.max(-1, Math.min(1, leftSamples[i]));
    const r = Math.max(-1, Math.min(1, rightSamples[i]));
    view.setInt16(offset, l < 0 ? l * 0x8000 : l * 0x7fff, true);
    view.setInt16(offset + 2, r < 0 ? r * 0x8000 : r * 0x7fff, true);
    offset += 4;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function buildCalibratedToneSamples(sampleRate) {
  const numFrames = Math.round(sampleRate * TONE_DURATION_SEC);
  const left = new Float32Array(numFrames);
  const right = new Float32Array(numFrames);
  const twoPiF = (2 * Math.PI * TONE_FREQ_HZ) / sampleRate;

  for (let i = 0; i < numFrames; i++) {
    const s = REF_PEAK_LINEAR * Math.sin(twoPiF * i);
    left[i] = s;
    right[i] = s;
  }
  return { left, right, sampleRate };
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

async function initEnvironmentInfo() {
  const uaMatch = navigator.userAgent.match(/(Edg|OPR|HeadlessChrome|Chrome|Firefox|Safari)\/([\d.]+)/);
  let browser = uaMatch
    ? `${uaMatch[1] === 'Edg' ? 'Edge' : uaMatch[1].replace('Headless', '')} ${uaMatch[2]}`
    : 'Browser';
  let os = navigator.platform || 'Unknown OS';
  if (/Win/i.test(navigator.userAgent)) os = 'Windows';
  else if (/Mac/i.test(navigator.userAgent)) os = 'macOS';
  else if (/Linux/i.test(navigator.userAgent)) os = 'Linux';

  if (navigator.userAgentData) {
    try {
      const ua = await navigator.userAgentData.getHighEntropyValues([
        'fullVersionList', 'platform', 'platformVersion', 'bitness',
      ]);
      const brand = (ua.fullVersionList || []).find(b =>
        /Google Chrome|Microsoft Edge|Chromium/i.test(b.brand)
      ) || (ua.fullVersionList || []).find(b => !/Not/i.test(b.brand));
      if (brand) browser = `${brand.brand} ${brand.version}`;
      if (ua.platform) {
        let winLabel = ua.platform;
        if (ua.platform === 'Windows' && ua.platformVersion) {
          const major = parseInt(ua.platformVersion.split('.')[0], 10);
          winLabel = major >= 13 ? `Windows 11 (${ua.platformVersion})` : `Windows 10 (${ua.platformVersion})`;
        }
        os = ua.bitness ? `${winLabel} ${ua.bitness}-bit` : winLabel;
      }
    } catch {
      // Keep userAgent fallback.
    }
  }

  state.browserLabel = browser;
  state.osLabel = os;
  $('env-badge').textContent = `${browser} \u00b7 ${os}`;
  probeAudioHardware();
}

function probeAudioHardware() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  try {
    const ctx = new Ctor();
    state.hwInfo.sampleRate = ctx.sampleRate;
    state.hwInfo.maxChannels = ctx.destination.maxChannelCount;
    state.hwInfo.baseLatencyMs = typeof ctx.baseLatency === 'number' ? (ctx.baseLatency * 1000) : null;
    state.hwInfo.outputLatencyMs = typeof ctx.outputLatency === 'number' ? (ctx.outputLatency * 1000) : null;

    $('hw-rate').textContent = `${ctx.sampleRate} Hz`;
    $('hw-channels').textContent = `${ctx.destination.maxChannelCount} ch`;
    $('hw-base-latency').textContent = state.hwInfo.baseLatencyMs !== null ? `${state.hwInfo.baseLatencyMs.toFixed(1)} ms` : '\u2014';
    $('hw-output-latency').textContent = state.hwInfo.outputLatencyMs !== null ? `${state.hwInfo.outputLatencyMs.toFixed(1)} ms` : '\u2014';
    ctx.close();
  } catch (err) {
    console.warn('AudioContext probe failed:', err);
  }
}

// ---------- Step 1: Playout ----------

async function stopPlayout() {
  const player = $('html-player');
  player.pause();
  player.removeAttribute('src');
  player.load();
  if (state.toneBlobUrl) {
    URL.revokeObjectURL(state.toneBlobUrl);
    state.toneBlobUrl = null;
  }
  if (state.playSourceNode) {
    try { state.playSourceNode.stop(); } catch { /* ignore */ }
    state.playSourceNode.disconnect();
    state.playSourceNode = null;
  }
  if (state.playAudioCtx) {
    try { await state.playAudioCtx.close(); } catch { /* ignore */ }
    state.playAudioCtx = null;
  }
  state.isPlaying = false;
  $('play-toggle-icon').textContent = 'play_arrow';
  $('play-toggle-label').textContent = 'Start playout';
  $('play-toggle-btn').className = 'btn btn-filled';
  const chip = $('playout-status-chip');
  chip.textContent = 'Stopped';
  chip.className = 'tonal-chip neutral';
}

async function startPlayout() {
  showAlert('');
  await stopPlayout();

  const sig = $('signal-select').value;
  const isTone = sig === 'tone440';
  const targetRate = state.hwInfo.sampleRate || 48000;

  try {
    if (state.playoutApi === 'html') {
      const player = $('html-player');
      if (isTone) {
        const { left, right, sampleRate } = buildCalibratedToneSamples(targetRate);
        const wavBlob = encodeStereoWav16(left, right, sampleRate);
        state.toneBlobUrl = URL.createObjectURL(wavBlob);
        player.src = state.toneBlobUrl;
      } else {
        player.src = sig;
      }
      player.volume = 1.0;
      await player.play();
    } else {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctor();
      state.playAudioCtx = ctx;

      let audioBuffer;
      if (isTone) {
        const { left, right, sampleRate } = buildCalibratedToneSamples(ctx.sampleRate);
        audioBuffer = ctx.createBuffer(2, left.length, sampleRate);
        audioBuffer.copyToChannel(left, 0);
        audioBuffer.copyToChannel(right, 1);
      } else {
        const resp = await fetch(sig);
        const arr = await resp.arrayBuffer();
        audioBuffer = await ctx.decodeAudioData(arr);
      }

      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.loop = true;
      src.connect(ctx.destination);
      src.start();
      state.playSourceNode = src;
    }

    state.isPlaying = true;
    $('play-toggle-icon').textContent = 'stop';
    $('play-toggle-label').textContent = 'Stop playout';
    $('play-toggle-btn').className = 'btn btn-outlined';

    const chip = $('playout-status-chip');
    chip.textContent = isTone ? 'Playing 440 Hz' : 'Playing speech';
    chip.className = 'tonal-chip active';
  } catch (err) {
    await stopPlayout();
    showAlert(`Playout failed: ${err.name}: ${err.message}`);
  }
}

// ---------- Step 2: System Audio Loopback & WAV ----------

async function startSystemCapture() {
  showAlert('');
  await stopSystemCapture();

  const options = {
    video: { displaySurface: 'monitor' },
    systemAudio: 'include',
    monitorTypeSurfaces: 'include',
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      restrictOwnAudio: false,
      suppressLocalAudioPlayback: false,
    },
  };

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia(options);
  } catch (err) {
    if (err.name !== 'NotAllowedError') {
      showAlert(`Capture failed: ${err.name}: ${err.message}`);
    }
    return;
  }

  // Stop video immediately; only audio loopback is needed.
  stream.getVideoTracks().forEach(t => t.stop());

  const [audioTrack] = stream.getAudioTracks();
  if (!audioTrack) {
    stream.getTracks().forEach(t => t.stop());
    showAlert('No audio track captured. Select your screen and check "Share with system audio" in the picker.');
    return;
  }

  state.captureStream = stream;
  audioTrack.addEventListener('ended', () => {
    stopSystemCapture();
  });

  const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
  const srText = settings.sampleRate ? `${settings.sampleRate} Hz` : 'default Hz';
  const chText = settings.channelCount ? `${settings.channelCount} ch` : 'stereo';
  $('stat-track-info').textContent = `${srText}, ${chText}`;

  const Ctor = window.AudioContext || window.webkitAudioContext;
  const meterCtx = new Ctor();
  state.meterCtx = meterCtx;

  const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
  const workletUrl = URL.createObjectURL(blob);
  await meterCtx.audioWorklet.addModule(workletUrl);
  URL.revokeObjectURL(workletUrl);

  const source = meterCtx.createMediaStreamSource(new MediaStream([audioTrack]));
  const worklet = new AudioWorkletNode(meterCtx, 'level-and-recorder', {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });
  state.meterWorklet = worklet;

  worklet.port.onmessage = (e) => handleWorkletMessage(e.data, meterCtx.sampleRate);
  source.connect(worklet);
  worklet.connect(meterCtx.destination);

  $('cap-toggle-icon').textContent = 'stop';
  $('cap-toggle-label').textContent = 'Stop capture';
  $('cap-toggle-btn').className = 'btn btn-danger-outlined';
  const chip = $('capture-status-chip');
  chip.textContent = 'Capturing';
  chip.className = 'tonal-chip active';
  $('save-reading-btn').disabled = false;
  $('record-wav-btn').disabled = false;
}

async function stopSystemCapture() {
  if (state.isRecordingWav) {
    finishWavRecording();
  }
  if (state.meterWorklet) {
    state.meterWorklet.disconnect();
    state.meterWorklet = null;
  }
  if (state.meterCtx) {
    try { await state.meterCtx.close(); } catch { /* ignore */ }
    state.meterCtx = null;
  }
  if (state.captureStream) {
    state.captureStream.getTracks().forEach(t => t.stop());
    state.captureStream = null;
  }
  state.latestMetrics = null;

  $('cap-toggle-icon').textContent = 'desktop_windows';
  $('cap-toggle-label').textContent = 'Capture system audio';
  $('cap-toggle-btn').className = 'btn btn-outlined';
  const chip = $('capture-status-chip');
  chip.textContent = 'Idle';
  chip.className = 'tonal-chip neutral';
  $('save-reading-btn').disabled = true;
  $('record-wav-btn').disabled = true;

  $('meter-bar-l').style.width = '0%';
  $('meter-bar-r').style.width = '0%';
  $('meter-val-l').textContent = '-\u221e dBFS';
  $('meter-val-r').textContent = '-\u221e dBFS';
  $('stat-peak').textContent = '-\u221e dBFS';
  $('stat-track-info').textContent = '\u2014';
}

function handleWorkletMessage(msg, sampleRate) {
  if (msg.type === 'pcm' && state.isRecordingWav) {
    state.wavChunksL.push(msg.left);
    state.wavChunksR.push(msg.right);
    state.wavCapturedFrames += msg.left.length;
    const remaining = Math.max(0, (state.wavTargetFrames - state.wavCapturedFrames) / sampleRate);
    $('record-wav-label').textContent = `Recording (${remaining.toFixed(1)}s)`;
    if (state.wavCapturedFrames >= state.wavTargetFrames) {
      finishWavRecording();
    }
    return;
  }

  if (msg.type === 'level') {
    const dbL = linearToDbfs(msg.rmsL);
    const dbR = linearToDbfs(msg.rmsR);
    const dbPeak = linearToDbfs(msg.peak);
    state.latestMetrics = { dbL, dbR, dbPeak };

    $('meter-bar-l').style.width = `${dbfsToPercent(dbL).toFixed(1)}%`;
    $('meter-bar-r').style.width = `${dbfsToPercent(dbR).toFixed(1)}%`;
    $('meter-val-l').textContent = formatDbfs(dbL);
    $('meter-val-r').textContent = formatDbfs(dbR);
    $('stat-peak').textContent = formatDbfs(dbPeak);
  }
}

// ---------- WAV Recording & Saved Readings ----------

function startWavRecording() {
  if (!state.meterWorklet || !state.meterCtx || state.isRecordingWav) return;
  state.isRecordingWav = true;
  state.wavChunksL = [];
  state.wavChunksR = [];
  state.wavCapturedFrames = 0;
  state.wavTargetFrames = Math.round(state.meterCtx.sampleRate * 5.0);
  $('record-wav-btn').disabled = true;
  $('record-wav-label').textContent = 'Recording (5.0s)';
  state.meterWorklet.port.postMessage({ recording: true });
}

function finishWavRecording() {
  if (!state.isRecordingWav) return;
  state.isRecordingWav = false;
  if (state.meterWorklet) {
    state.meterWorklet.port.postMessage({ recording: false });
  }
  $('record-wav-btn').disabled = !state.captureStream;
  $('record-wav-label').textContent = 'Record 5s WAV';

  const total = state.wavCapturedFrames;
  if (!total || !state.meterCtx) return;

  const left = new Float32Array(total);
  const right = new Float32Array(total);
  let pos = 0;
  let sumSqL = 0;
  let sumSqR = 0;
  let peak = 0;

  for (let c = 0; c < state.wavChunksL.length; c++) {
    const cL = state.wavChunksL[c];
    const cR = state.wavChunksR[c];
    left.set(cL, pos);
    right.set(cR, pos);
    for (let i = 0; i < cL.length; i++) {
      sumSqL += cL[i] * cL[i];
      sumSqR += cR[i] * cR[i];
      const m = Math.max(Math.abs(cL[i]), Math.abs(cR[i]));
      if (m > peak) peak = m;
    }
    pos += cL.length;
  }

  const sr = state.meterCtx.sampleRate;
  const wavBlob = encodeStereoWav16(left, right, sr);
  const url = URL.createObjectURL(wavBlob);

  const preview = $('wav-preview');
  if (preview.dataset.blobUrl) URL.revokeObjectURL(preview.dataset.blobUrl);
  preview.dataset.blobUrl = url;
  preview.src = url;

  const browserSlug = (state.browserLabel || 'browser').toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const link = $('wav-download-link');
  link.href = url;
  link.download = `${browserSlug}-system-audio-5s.wav`;
  $('wav-result-row').hidden = false;

  appendReading({
    dbL: linearToDbfs(Math.sqrt(sumSqL / total)),
    dbR: linearToDbfs(Math.sqrt(sumSqR / total)),
    dbPeak: linearToDbfs(peak),
    source: '5s WAV avg',
  });
  showToast('Recorded 5s WAV and saved reading');
}

function saveCurrentReading() {
  if (!state.latestMetrics) {
    showToast('Wait a moment for level metrics');
    return;
  }
  appendReading({
    dbL: state.latestMetrics.dbL,
    dbR: state.latestMetrics.dbR,
    dbPeak: state.latestMetrics.dbPeak,
    source: 'Snapshot',
  });
  showToast('Reading saved');
}

function appendReading({ dbL, dbR, dbPeak, source }) {
  const sigValue = $('signal-select').value;
  const sigShort = sigValue === 'tone440' ? '440 Hz (-15 dBFS)' : 'harvard.wav';

  state.readings.push({
    index: state.readings.length + 1,
    api: state.playoutApi === 'html' ? '<audio> element' : 'Web Audio',
    signal: sigShort,
    dbL: formatDbfs(dbL),
    dbR: formatDbfs(dbR),
    dbPeak: formatDbfs(dbPeak),
    source,
  });
  renderReadingsTable();
}

function renderReadingsTable() {
  const tbody = $('readings-tbody');
  $('clear-readings-btn').hidden = state.readings.length === 0;
  if (state.readings.length === 0) {
    tbody.innerHTML = `<tr id="empty-readings-row"><td colspan="7" class="empty-table-msg">No readings yet. Start playout, capture system audio, then click <strong>Save reading</strong> or <strong>Record 5s WAV</strong>.</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  for (const r of state.readings) {
    const tr = document.createElement('tr');
    const cells = [
      [r.index, false],
      [r.api, false],
      [r.signal, false],
      [r.dbL, true],
      [r.dbR, true],
      [r.dbPeak, true],
      [r.source, false],
    ];
    for (const [val, isNum] of cells) {
      const td = document.createElement('td');
      if (isNum) td.className = 'num-col';
      td.textContent = val;
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
}

async function copyMarkdownReport() {
  const lines = [
    '### Audio playout diagnostic report',
    `- **Browser**: ${state.browserLabel}`,
    `- **OS**: ${state.osLabel}`,
    `- **AudioContext hardware**: ${state.hwInfo.sampleRate ?? 'N/A'} Hz, maxChannels=${state.hwInfo.maxChannels ?? 'N/A'}, baseLatency=${state.hwInfo.baseLatencyMs !== null ? state.hwInfo.baseLatencyMs.toFixed(1) + ' ms' : 'N/A'}, outputLatency=${state.hwInfo.outputLatencyMs !== null ? state.hwInfo.outputLatencyMs.toFixed(1) + ' ms' : 'N/A'}`,
    '',
  ];

  if (state.readings.length > 0) {
    lines.push('| # | Playout path | Test signal | L RMS | R RMS | Peak | Source |');
    lines.push('|---:|:---|:---|---:|---:|---:|:---|');
    for (const r of state.readings) {
      lines.push(`| ${r.index} | \`${r.api}\` | ${r.signal} | ${r.dbL} | ${r.dbR} | ${r.dbPeak} | ${r.source} |`);
    }
  } else if (state.latestMetrics) {
    lines.push(`- **Live system audio**: L=${formatDbfs(state.latestMetrics.dbL)}, R=${formatDbfs(state.latestMetrics.dbR)}, Peak=${formatDbfs(state.latestMetrics.dbPeak)}`);
  } else {
    lines.push('_No readings recorded._');
  }

  await navigator.clipboard.writeText(lines.join('\n'));
  showToast('Markdown report copied');
}

function selectPlayoutApi(api) {
  state.playoutApi = api;
  document.querySelectorAll('[data-api]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.api === api));
  });
  if (state.isPlaying) startPlayout();
}

function initThemeToggle() {
  const root = document.documentElement;
  const saved = localStorage.getItem('audio-playout-demo.theme');
  if (saved === 'light' || saved === 'dark') {
    root.dataset.theme = saved;
  }
  const syncIcon = () => {
    const isDark = root.dataset.theme === 'dark' ||
      (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    $('theme-icon').textContent = isDark ? 'light_mode' : 'dark_mode';
  };
  syncIcon();

  $('theme-toggle-btn').addEventListener('click', () => {
    const currentlyDark = root.dataset.theme === 'dark' ||
      (!root.dataset.theme && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const next = currentlyDark ? 'light' : 'dark';
    root.dataset.theme = next;
    localStorage.setItem('audio-playout-demo.theme', next);
    syncIcon();
  });
}

function init() {
  initThemeToggle();
  initEnvironmentInfo();

  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', probeAudioHardware);
  }

  document.querySelectorAll('[data-api]').forEach(btn => {
    btn.addEventListener('click', () => selectPlayoutApi(btn.dataset.api));
  });

  $('signal-select').addEventListener('change', () => {
    if (state.isPlaying) startPlayout();
  });

  $('play-toggle-btn').addEventListener('click', () => {
    if (state.isPlaying) stopPlayout();
    else startPlayout();
  });

  $('cap-toggle-btn').addEventListener('click', () => {
    if (state.captureStream) stopSystemCapture();
    else startSystemCapture();
  });

  $('save-reading-btn').addEventListener('click', saveCurrentReading);
  $('record-wav-btn').addEventListener('click', startWavRecording);

  $('clear-readings-btn').addEventListener('click', () => {
    state.readings = [];
    renderReadingsTable();
  });

  $('copy-report-btn').addEventListener('click', copyMarkdownReport);
}

init();
