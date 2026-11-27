// navigator.audioOutput demo (prototype, Blink RuntimeEnabledFeature
// AudioOutputState). Audio side (playback paths, device list, Chrome log
// lines) adapted from audio-session-demo; support check, live readout, and
// event log from device-state-apis (DemoKit).
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('audio-output-state');
  const output = navigator.audioOutput;
  const hasOutput = !!output;
  const hasDevices = !!(navigator.mediaDevices && navigator.mediaDevices.enumerateDevices);
  const counts = { mute: 0, unmute: 0, change: 0 };

  const TONE_DURATION_SEC = 2;   // Looped, so the length only affects memory.
  const TONE_PEAK = 0.25;        // Linear peak of the generated sine.
  const PATH_LABELS = {
    'html': '<audio> element',
    'webaudio-playback': 'Web Audio (playback)',
    'webaudio-interactive': 'Web Audio (interactive)',
  };
  const STATE_ICONS = { audible: 'volume_up', quiet: 'volume_down', muted: 'volume_off', unknown: 'help' };

  const devices = { list: [], labelsGranted: false };
  // The running player, or null.
  let player = null;

  // ---------- Utilities ----------

  const pad = (n, width = 2) => String(n).padStart(width, '0');

  // Same format as the chrome_debug.log prefix: MMDD/HHMMSS.mmm (local time).
  function chromeTime(d) {
    return `${pad(d.getMonth() + 1)}${pad(d.getDate())}/` +
           `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}.` +
           `${pad(d.getMilliseconds(), 3)}`;
  }

  const fmtLevel = (level) => (level === null || level === undefined ? 'null' : `${level} dB`);
  const fmtSink = (id) => (id === '' ? '"" (default)' : JSON.stringify(id));

  function shortId(id) {
    if (!id) return '(empty)';
    if (id === 'default' || id === 'communications') return id;
    return id.length > 12 ? `${id.slice(0, 12)}…` : id;
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

  // ---------- State ----------

  function snapshot() {
    if (!hasOutput) return null;
    return { sinkId: output.sinkId, state: output.state, muted: output.muted, level: output.level };
  }

  function describe() {
    const s = snapshot();
    return s ? `state=${s.state}, muted=${s.muted}, level=${fmtLevel(s.level)}` : 'not supported';
  }

  // ---------- Rendering ----------

  function renderSupport() {
    $('support-row').replaceChildren(
      hasOutput ? chip('navigator.audioOutput', 'ok', 'check_circle')
                : chip('navigator.audioOutput missing', 'bad', 'cancel'),
      window.isSecureContext ? chip('Secure context', 'ok', 'lock') : chip('Not a secure context', 'bad', 'lock_open'),
      typeof AudioContext !== 'undefined' && 'setSinkId' in AudioContext.prototype
        ? chip('AudioContext.setSinkId()', 'ok', 'check_circle')
        : chip('AudioContext.setSinkId() missing', 'warn', 'cancel'),
      debugChip(),
    );
    $('flag-note').hidden = hasOutput;
  }

  function renderState() {
    const s = snapshot();
    if (!s) {
      $('state-icon').textContent = 'help';
      $('state-value').textContent = 'not supported';
      $('level-unit').textContent = '';
      for (const id of ['v-sink', 'v-state', 'v-muted', 'v-level']) setKv(id, '—');
      return;
    }
    $('state-icon').textContent = STATE_ICONS[s.state] || 'help';
    $('state-value').textContent = s.state;
    $('level-unit').textContent = s.level === null ? '' : `${s.level} dB`;
    setKv('v-sink', fmtSink(s.sinkId));
    setKv('v-state', s.state);
    setKv('v-muted', String(s.muted));
    setKv('v-level', fmtLevel(s.level), s.level === null ? 'unknown or muted' : '10 dB steps');
    setKv('v-counts', `${counts.mute} mute, ${counts.unmute} unmute, ${counts.change} change`);
  }

  function playerSinkId() {
    if (!player) return undefined;
    if (player.audioEl) return player.audioEl.sinkId;
    if (player.ctx && 'sinkId' in player.ctx) return player.ctx.sinkId;
    return undefined;
  }

  function renderPlayer() {
    const volume = Number($('volume-input').value);
    $('volume-value').textContent = volume.toFixed(2);
    setKv('p-status', player ? 'Playing' : 'Idle');
    setKv('p-path', player ? `${PATH_LABELS[player.path]}, ${player.freq} Hz` : '—');
    const sink = playerSinkId();
    setKv('p-sink', sink === undefined ? '—' : fmtSink(typeof sink === 'string' ? sink : 'n/a'));
    setKv('p-volume', volume.toFixed(2), 'Chrome scales the samples; not the Windows session');
    const btn = $('play-btn');
    btn.querySelector('.icon').textContent = player ? 'stop' : 'play_arrow';
    btn.querySelector('.label').textContent = player ? 'Destroy' : 'Create & play';
    btn.classList.toggle('btn-active', !!player);
    $('path-select').disabled = !!player;
    $('freq-select').disabled = !!player;
  }

  function touch() {
    $('v-updated').textContent = new Date().toLocaleTimeString();
  }

  // ---------- Log ----------

  const log = createLog({
    api: 'navigator.audioOutput (prototype)',
    spec: 'https://artifacts.corp.google.com/SNEYZFIW3B',
    filePrefix: 'audio-output-state-log',
    snapshot,
    dbg,
    formatTime: chromeTime,
    extra: () => ({
      devices: devices.list,
      player: player ? { path: player.path, freq: player.freq, sinkId: playerSinkId() ?? null } : null,
    }),
  });

  // ---------- navigator.audioOutput ----------

  function watchOutput() {
    for (const type of ['mute', 'unmute', 'change']) {
      output.addEventListener(type, (ev) => {
        counts[type]++;
        dbg.group(`audioOutput event: ${type}`, { event: ev, timeStamp: ev.timeStamp, state: snapshot() });
        renderState();
        touch();
        log.add(type, describe());
      });
    }
  }

  // ---------- Devices ----------

  async function loadDevices() {
    if (!hasDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    devices.list = all.filter((d) => d.kind === 'audiooutput').map((d) => ({
      deviceId: d.deviceId, label: d.label, groupId: d.groupId,
    }));
    dbg.table('audio outputs', devices.list);
    renderDevices();
  }

  function renderDevices() {
    const tbody = $('devices-tbody');
    tbody.replaceChildren();
    for (const d of devices.list) {
      const tr = document.createElement('tr');
      for (const val of [d.label || '(no label)', d.deviceId || '(empty)', d.groupId || '']) {
        const td = document.createElement('td');
        td.textContent = val;
        tr.append(td);
      }
      tbody.append(tr);
    }
    if (devices.list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-table-msg">No output devices reported.</td></tr>';
    }
    const c = $('devices-chip');
    c.textContent = `${devices.list.length} output device(s)${devices.labelsGranted ? '' : ', no names'}`;
    c.className = `chip ${devices.labelsGranted ? 'ok' : ''}`.trim();

    // Device picker: "" (default) and "communications" are always offered.
    const select = $('device-select');
    const previous = select.value;
    select.replaceChildren();
    const add = (value, text) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = text;
      select.append(option);
    };
    add('', 'Default ("")');
    add('communications', 'Default communications ("communications")');
    for (const d of devices.list) {
      if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
      add(d.deviceId, `${d.label || '(no label)'} [${shortId(d.deviceId)}]`);
    }
    if ([...select.options].some((o) => o.value === previous)) select.value = previous;
  }

  async function grantLabels() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      devices.labelsGranted = true;
      await loadDevices();
      log.add('devices', `device names loaded, ${devices.list.length} output devices`);
    } catch (err) {
      dbg('getUserMedia failed', err);
      log.add('devices', `getUserMedia() failed: ${err.name}: ${err.message}`);
    }
  }

  // ---------- Player ----------

  async function createPlayer() {
    const path = $('path-select').value;
    const freq = Number($('freq-select').value);
    const sinkId = $('device-select').value;
    const volume = Number($('volume-input').value);
    const p = { path, freq, audioEl: null, ctx: null, gain: null };
    try {
      if (path === 'html') {
        const audio = new Audio();
        audio.loop = true;
        audio.src = toneUrl(freq);
        audio.volume = volume;
        await audio.setSinkId(sinkId);
        await audio.play();
        p.audioEl = audio;
      } else {
        const latencyHint = path === 'webaudio-playback' ? 'playback' : 'interactive';
        const ctx = new AudioContext({ latencyHint, sinkId });
        const osc = new OscillatorNode(ctx, { frequency: freq });
        const gain = new GainNode(ctx, { gain: volume });
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        await ctx.resume();
        p.ctx = ctx;
        p.gain = gain;
      }
      player = p;
      log.add('player', `create & play: ${PATH_LABELS[path]}, ${freq} Hz, page volume ${volume.toFixed(2)}, sinkId ${fmtSink(sinkId)}`);
    } catch (err) {
      await destroyResources(p);
      log.add('player', `create failed: ${err.name}: ${err.message}`);
    }
    renderPlayer();
  }

  async function destroyResources(p) {
    if (p.audioEl) {
      p.audioEl.pause();
      p.audioEl.removeAttribute('src');
      p.audioEl.load();
      p.audioEl = null;
    }
    if (p.ctx) {
      await p.ctx.close().catch(() => {});
      p.ctx = null;
      p.gain = null;
    }
  }

  async function destroyPlayer() {
    const p = player;
    player = null;
    await destroyResources(p);
    log.add('player', 'destroy');
    renderPlayer();
  }

  function applyVolume() {
    const volume = Number($('volume-input').value);
    if (player && player.audioEl) player.audioEl.volume = volume;
    if (player && player.gain) player.gain.gain.value = volume;
    renderPlayer();
  }

  // ---------- setSinkId ----------

  async function applyDevice() {
    const sinkId = $('device-select').value;
    if (player) {
      try {
        if (player.audioEl) await player.audioEl.setSinkId(sinkId);
        else if (player.ctx) await player.ctx.setSinkId(sinkId);
        log.add('setSinkId', `player.setSinkId(${fmtSink(sinkId)}) resolved`);
      } catch (err) {
        log.add('setSinkId', `player.setSinkId(${fmtSink(sinkId)}) failed: ${err.name}: ${err.message}`);
      }
      renderPlayer();
    }
    if (hasOutput) {
      try {
        await output.setSinkId(sinkId);
        log.add('setSinkId', `audioOutput.setSinkId(${fmtSink(sinkId)}) resolved; ${describe()}`);
      } catch (err) {
        log.add('setSinkId', `audioOutput.setSinkId(${fmtSink(sinkId)}) failed: ${err.name}: ${err.message}`);
      }
      renderState();
    }
  }

  // ---------- Init ----------

  function init() {
    renderSupport();
    renderDevices();
    $('grant-labels-btn').addEventListener('click', grantLabels);
    $('refresh-devices-btn').addEventListener('click', () => loadDevices().then(() => log.add('devices', 'refreshed')));
    $('apply-btn').addEventListener('click', applyDevice);
    $('play-btn').addEventListener('click', () => (player ? destroyPlayer() : createPlayer()));
    $('volume-input').addEventListener('input', applyVolume);
    $('volume-input').addEventListener('change', () => {
      if (player) log.add('player', `page volume ${Number($('volume-input').value).toFixed(2)} (no audioOutput event expected)`);
    });
    $('copy-cmd-btn').addEventListener('click', async (ev) => {
      const label = ev.currentTarget.querySelector('.label');
      try {
        await navigator.clipboard.writeText($('ps-cmd').textContent);
        label.textContent = 'Copied';
      } catch {
        label.textContent = 'Copy failed';
      }
      setTimeout(() => { label.textContent = 'Copy'; }, 1500);
    });
    $('grant-labels-btn').disabled = !hasDevices;
    $('refresh-devices-btn').disabled = !hasDevices;
    if (hasOutput) {
      watchOutput();
      log.add('initial', describe());
    } else {
      $('apply-btn').disabled = true;
      $('log-empty').textContent = 'navigator.audioOutput is not available; see the note above.';
    }
    if (hasDevices) {
      navigator.mediaDevices.addEventListener('devicechange', () => {
        log.add('devicechange', 'device list changed');
        loadDevices();
      });
      loadDevices();
    }
    renderState();
    renderPlayer();
    mountSystemDiagnostics(dbg);
  }

  init();
})();
