// Records the microphone through different WebAudio paths so that crackles
// and dropouts can be compared. Self-contained: shares no code with the main
// gum-demo page.

const $ = (id) => document.getElementById(id);

const ui = {
  device: $('device'),
  ec: $('ec'),
  ns: $('ns'),
  agc: $('agc'),
  ctxRate: $('ctx-rate'),
  ctxLatency: $('ctx-latency'),
  spSize: $('sp-size'),
  mime: $('mime'),
  jank: $('jank'),
  jankMs: $('jank-ms'),
  jankEvery: $('jank-every'),
  start: $('start'),
  stop: $('stop'),
  status: $('status'),
  error: $('error'),
  results: $('results'),
};

const PATH_LABELS = {
  direct: '0. Direct → MediaRecorder',
  msdest: '1. MediaStreamDestination → MediaRecorder',
  script: '2. ScriptProcessorNode → WAV',
  worklet: '3. AudioWorklet → WAV',
};

/** State of the active recording, or null. */
let session = null;
let recordingCount = 0;

// ---------- Setup ----------

function fillMimeTypes() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/ogg;codecs=opus',
    'audio/webm;codecs=pcm',
    'audio/mp4;codecs=opus',
    'audio/mp4',
  ];
  for (const type of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(type)) {
      ui.mime.add(new Option(type, type));
    }
  }
}

async function fillDevices() {
  const selected = ui.device.value;
  const devices = await navigator.mediaDevices.enumerateDevices();
  ui.device.length = 1;
  devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
    .forEach((d, i) => ui.device.add(new Option(d.label || `Microphone ${i + 1}`, d.deviceId)));
  ui.device.value = selected;
  if (ui.device.selectedIndex < 0) ui.device.value = '';
}

function selectedPath() {
  return document.querySelector('input[name=path]:checked').value;
}

function audioConstraints() {
  const c = {
    echoCancellation: ui.ec.checked,
    noiseSuppression: ui.ns.checked,
    autoGainControl: ui.agc.checked,
  };
  if (ui.device.value) c.deviceId = { exact: ui.device.value };
  return c;
}

function contextOptions() {
  const opts = {};
  if (ui.ctxRate.value) opts.sampleRate = Number(ui.ctxRate.value);
  if (ui.ctxLatency.value) opts.latencyHint = ui.ctxLatency.value;
  return opts;
}

// ---------- Jank simulator ----------

function startJank() {
  if (!ui.jank.checked) return null;
  const blockMs = Math.max(1, Number(ui.jankMs.value) || 0);
  const everyMs = Math.max(10, Number(ui.jankEvery.value) || 0);
  return setInterval(() => {
    const end = performance.now() + blockMs;
    while (performance.now() < end) { /* busy wait */ }
  }, everyMs);
}

// ---------- Stats helpers ----------

function trackStatsSnapshot(track) {
  const s = track.stats;
  if (!s) return null;
  return {
    deliveredFrames: s.deliveredFrames,
    totalFrames: s.totalFrames,
    deliveredFramesDuration: s.deliveredFramesDuration,
    totalFramesDuration: s.totalFramesDuration,
  };
}

/** Capture-side frames that the track did not deliver during the recording. */
function trackStatsDelta(before, after) {
  if (!before || !after) return 'not supported';
  const total = after.totalFrames - before.totalFrames;
  const delivered = after.deliveredFrames - before.deliveredFrames;
  const droppedMs = (after.totalFramesDuration - before.totalFramesDuration) -
    (after.deliveredFramesDuration - before.deliveredFramesDuration);
  return { totalFrames: total, deliveredFrames: delivered, droppedFrames: total - delivered,
    droppedMs: Math.round(droppedMs) };
}

function playoutStats(ctx) {
  const s = ctx && ctx.playoutStats;
  if (!s) return undefined;
  return typeof s.toJSON === 'function' ? s.toJSON() : s;
}

function contextInfo(ctx) {
  if (!ctx) return undefined;
  return {
    sampleRate: ctx.sampleRate,
    baseLatency: ctx.baseLatency,
    outputLatency: ctx.outputLatency,
  };
}

/**
 * Heuristic scan of PCM for dropouts and clicks.
 * - zeroRuns: runs of near-silence of 1 ms or more that are not at the start
 *   or end. A FIFO underrun in WebAudio inserts zeros.
 * - jumps: sample-to-sample steps above 0.5 (clicks, discontinuities).
 */
function analyzePcm(samples, sampleRate, zeroLevel) {
  const minRun = Math.max(1, Math.round(sampleRate / 1000));
  let runs = 0;
  let runSamples = 0;
  let longestRun = 0;
  let jumps = 0;
  let peak = 0;
  // Ignore leading and trailing silence.
  let first = 0;
  while (first < samples.length && Math.abs(samples[first]) <= zeroLevel) first++;
  let last = samples.length - 1;
  while (last > first && Math.abs(samples[last]) <= zeroLevel) last--;
  let run = 0;
  for (let i = first; i <= last; i++) {
    const x = samples[i];
    const a = Math.abs(x);
    if (a > peak) peak = a;
    if (i > first && Math.abs(x - samples[i - 1]) > 0.5) jumps++;
    if (a <= zeroLevel) {
      run++;
    } else {
      if (run >= minRun) {
        runs++;
        runSamples += run;
        longestRun = Math.max(longestRun, run);
      }
      run = 0;
    }
  }
  return {
    zeroRuns: runs,
    zeroRunsMs: +(1000 * runSamples / sampleRate).toFixed(1),
    longestZeroRunMs: +(1000 * longestRun / sampleRate).toFixed(1),
    jumps,
    peak: +peak.toFixed(3),
  };
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buffer);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

function concat(chunks) {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

// ---------- Recording paths ----------

function startMediaRecorder(stream, s) {
  const opts = ui.mime.value ? { mimeType: ui.mime.value } : {};
  const rec = new MediaRecorder(stream, opts);
  s.chunks = [];
  rec.ondataavailable = (e) => { if (e.data.size) s.chunks.push(e.data); };
  rec.start(1000);
  s.recorder = rec;
}

async function setupPath(s) {
  if (s.path === 'direct') {
    startMediaRecorder(s.stream, s);
    return;
  }
  const ctx = new AudioContext(contextOptions());
  s.ctx = ctx;
  if (ctx.state !== 'running') await ctx.resume();
  const src = ctx.createMediaStreamSource(s.stream);
  s.nodes = [src];

  if (s.path === 'msdest') {
    const dest = ctx.createMediaStreamDestination();
    src.connect(dest);
    s.nodes.push(dest);
    startMediaRecorder(dest.stream, s);
    return;
  }

  if (s.path === 'script') {
    const size = Number(ui.spSize.value);
    const sp = ctx.createScriptProcessor(size, 1, 1);
    const st = { size, callbacks: 0, gaps: 0, gapMs: 0, gapsAtMs: [], maxIntervalMs: 0, lastPlaybackTime: -1, firstPlaybackTime: -1, lastNow: 0 };
    s.pcm = [];
    s.sp = st;
    sp.onaudioprocess = (e) => {
      const now = performance.now();
      if (st.lastNow) st.maxIntervalMs = Math.max(st.maxIntervalMs, now - st.lastNow);
      st.lastNow = now;
      // playbackTime advances by size/sampleRate per buffer. A larger step
      // means that buffers were skipped.
      const step = size / ctx.sampleRate;
      if (st.lastPlaybackTime >= 0) {
        const late = e.playbackTime - st.lastPlaybackTime - step;
        if (late > step / 2) {
          st.gaps++;
          st.gapMs += late * 1000;
          if (st.gapsAtMs.length < 20) st.gapsAtMs.push(Math.round(1000 * (st.lastPlaybackTime - st.firstPlaybackTime)));
        }
      }
      if (st.firstPlaybackTime < 0) st.firstPlaybackTime = e.playbackTime;
      st.lastPlaybackTime = e.playbackTime;
      st.callbacks++;
      s.pcm.push(new Float32Array(e.inputBuffer.getChannelData(0)));
    };
    src.connect(sp);
    sp.connect(ctx.destination); // Required for onaudioprocess to fire. Output is silent.
    s.nodes.push(sp);
    return;
  }

  if (s.path === 'worklet') {
    await ctx.audioWorklet.addModule('pcm-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit' });
    const st = { messages: 0, gaps: 0, gapFrames: 0, gapsAtMs: [], firstFrame: -1, nextFrame: -1, emptyQuanta: 0 };
    s.pcm = [];
    s.wk = st;
    node.port.onmessage = (e) => {
      const { startFrame, data, emptyQuanta } = e.data;
      if (st.firstFrame < 0) st.firstFrame = startFrame;
      if (st.nextFrame >= 0 && startFrame !== st.nextFrame) {
        st.gaps++;
        st.gapFrames += startFrame - st.nextFrame;
        if (st.gapsAtMs.length < 20) st.gapsAtMs.push(Math.round(1000 * (st.nextFrame - st.firstFrame) / ctx.sampleRate));
      }
      st.nextFrame = startFrame + data.length;
      st.emptyQuanta = emptyQuanta;
      st.messages++;
      s.pcm.push(data);
    };
    src.connect(node);
    node.connect(ctx.destination); // Keeps the node pulled. Output is silent.
    s.nodes.push(node);
    s.workletNode = node;
  }
}

async function start() {
  ui.error.textContent = '';
  ui.start.disabled = true;
  const s = { path: selectedPath(), startedAt: 0 };
  try {
    s.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints() });
    s.track = s.stream.getAudioTracks()[0];
    fillDevices().catch(() => {});
    await setupPath(s);
    s.statsBefore = trackStatsSnapshot(s.track);
    s.playoutBefore = playoutStats(s.ctx);
    s.jankTimer = startJank();
    s.startedAt = performance.now();
    s.timer = setInterval(() => updateStatus(s), 250);
    session = s;
    ui.stop.disabled = false;
    updateStatus(s);
  } catch (err) {
    ui.error.textContent = `${err.name || 'Error'}: ${err.message}`;
    cleanup(s);
    ui.start.disabled = false;
  }
}

function updateStatus(s) {
  const secs = ((performance.now() - s.startedAt) / 1000).toFixed(1);
  let extra = '';
  if (s.sp) extra = ` · callbacks ${s.sp.callbacks} · gaps ${s.sp.gaps}`;
  if (s.wk) extra = ` · gaps ${s.wk.gaps}`;
  ui.status.textContent = `Recording ${PATH_LABELS[s.path]} · ${secs} s${extra}`;
}

function cleanup(s) {
  clearInterval(s.timer);
  clearInterval(s.jankTimer);
  (s.nodes || []).forEach((n) => { try { n.disconnect(); } catch { /* ignore */ } });
  if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
  if (s.ctx && s.ctx.state !== 'closed') s.ctx.close().catch(() => {});
}

function stopRecorder(rec) {
  return new Promise((resolve) => {
    rec.addEventListener('stop', resolve, { once: true });
    rec.stop();
  });
}

async function stop() {
  const s = session;
  if (!s) return;
  session = null;
  ui.stop.disabled = true;
  clearInterval(s.jankTimer);
  const wallMs = performance.now() - s.startedAt;
  const statsAfter = trackStatsSnapshot(s.track);
  const playoutAfter = playoutStats(s.ctx);

  if (s.workletNode) {
    // Stop the input first so that the flush wait adds no audio.
    s.nodes[0].disconnect();
    s.workletNode.port.postMessage('flush');
    await new Promise((r) => setTimeout(r, 100));
  }
  if (s.recorder) await stopRecorder(s.recorder);

  const info = {
    path: PATH_LABELS[s.path],
    wallClockMs: Math.round(wallMs),
    constraints: audioConstraints(),
    trackSettings: s.track.getSettings(),
    trackLabel: s.track.label,
    audioContext: s.ctx ? { options: contextOptions(), ...contextInfo(s.ctx) } : undefined,
    jank: ui.jank.checked ? { blockMs: Number(ui.jankMs.value), everyMs: Number(ui.jankEvery.value) } : undefined,
    trackStatsDelta: trackStatsDelta(s.statsBefore, statsAfter),
    playoutStatsBefore: s.playoutBefore,
    playoutStatsAfter: playoutAfter,
  };

  const ctxRate = s.ctx ? s.ctx.sampleRate : 0;
  cleanup(s);

  let blob;
  let fileExt;
  let analysis;
  if (s.pcm) {
    const samples = concat(s.pcm);
    blob = encodeWav(samples, ctxRate);
    fileExt = 'wav';
    info.capturedMs = Math.round(1000 * samples.length / ctxRate);
    if (s.sp) {
      info.scriptProcessor = {
        bufferSize: s.sp.size,
        callbacks: s.sp.callbacks,
        droppedBufferGaps: s.sp.gaps,
        droppedMs: Math.round(s.sp.gapMs),
        gapsAtMs: s.sp.gapsAtMs,
        maxCallbackIntervalMs: Math.round(s.sp.maxIntervalMs),
        expectedIntervalMs: +(1000 * s.sp.size / ctxRate).toFixed(1),
      };
    }
    if (s.wk) {
      info.audioWorklet = {
        messages: s.wk.messages,
        frameGaps: s.wk.gaps,
        missingMs: +(1000 * s.wk.gapFrames / ctxRate).toFixed(1),
        gapsAtMs: s.wk.gapsAtMs,
        quantaWithoutInput: s.wk.emptyQuanta,
      };
    }
    analysis = analyzePcm(samples, ctxRate, 1e-6);
  } else {
    blob = new Blob(s.chunks, { type: s.recorder.mimeType });
    info.mimeType = s.recorder.mimeType;
    fileExt = s.recorder.mimeType.includes('ogg') ? 'ogg' : s.recorder.mimeType.includes('mp4') ? 'm4a' : 'webm';
    analysis = await analyzeEncoded(blob, info);
  }
  info.pcmScan = analysis;

  addResult(info, blob, fileExt);
  ui.status.textContent = '';
  ui.start.disabled = false;
}

/** Decodes a MediaRecorder blob and scans it. Lossy codecs blur exact zeros, so this is approximate. */
async function analyzeEncoded(blob, info) {
  try {
    const decoder = new OfflineAudioContext(1, 1, 48000);
    const audio = await decoder.decodeAudioData(await blob.arrayBuffer());
    info.decodedMs = Math.round(audio.duration * 1000);
    return { decodedAt: audio.sampleRate, ...analyzePcm(audio.getChannelData(0), audio.sampleRate, 1e-4) };
  } catch (err) {
    return `decode failed: ${err.message}`;
  }
}

function addResult(info, blob, fileExt) {
  recordingCount++;
  const url = URL.createObjectURL(blob);
  const card = document.createElement('section');
  card.className = 'card result';
  const h = document.createElement('h3');
  h.textContent = `#${recordingCount} ${info.path}`;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.src = url;
  const a = document.createElement('a');
  a.href = url;
  a.download = `webaudio-rec-${recordingCount}-${info.path.split('.')[0]}.${fileExt}`;
  a.textContent = ` Download .${fileExt}`;
  const summary = document.createElement('div');
  summary.innerHTML = summaryHtml(info);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(info, null, 2);
  const details = document.createElement('details');
  const sum = document.createElement('summary');
  sum.textContent = 'Details';
  details.append(sum, pre);
  card.append(h, audio, a, summary, details);
  ui.results.prepend(card);
}

function summaryHtml(info) {
  const parts = [];
  const flag = (cond, text) => parts.push(cond ? `<span class="bad">${text}</span>` : text);
  const td = info.trackStatsDelta;
  if (td && typeof td === 'object') flag(td.droppedFrames > 0, `capture dropped: ${td.droppedFrames} frames (${td.droppedMs} ms)`);
  if (info.scriptProcessor) flag(info.scriptProcessor.droppedBufferGaps > 0, `ScriptProcessor gaps: ${info.scriptProcessor.droppedBufferGaps} (${info.scriptProcessor.droppedMs} ms)`);
  if (info.audioWorklet) flag(info.audioWorklet.frameGaps > 0, `worklet gaps: ${info.audioWorklet.frameGaps} (${info.audioWorklet.missingMs} ms)`);
  const scan = info.pcmScan;
  if (scan && typeof scan === 'object') {
    flag(scan.zeroRuns > 0, `zero runs ≥1 ms: ${scan.zeroRuns} (${scan.zeroRunsMs} ms)`);
    flag(scan.jumps > 0, `jumps > 0.5: ${scan.jumps}`);
  }
  const dur = info.capturedMs ?? info.decodedMs;
  if (dur !== undefined) parts.push(`length ${dur} ms of ${info.wallClockMs} ms wall clock`);
  return parts.join(' · ');
}

// ---------- Init ----------

fillMimeTypes();
fillDevices().catch(() => {});
navigator.mediaDevices.addEventListener('devicechange', () => fillDevices().catch(() => {}));
ui.start.addEventListener('click', start);
ui.stop.addEventListener('click', stop);
