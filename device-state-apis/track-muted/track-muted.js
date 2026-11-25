// MediaStreamTrack muted demo: microphone track and WebRTC loopback received
// track, with mute/unmute/ended events, enabled toggles on both tracks,
// renegotiation to stop sending, waveform scopes, and optional listening.
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('track-muted');
  const hasGum = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);

  let stream = null;
  let track = null;
  const localCounts = { mute: 0, unmute: 0 };

  let pc1 = null;
  let pc2 = null;
  let remoteTrack = null;
  let remoteAudio = null;   // <audio> that plays the received stream (muted unless Listen)
  let sendingPaused = false;
  const remoteCounts = { mute: 0, unmute: 0 };

  // ---------- Colors (light-dark() vars resolved for canvas) ----------

  let colorProbe = null;
  function cssColor(name) {
    if (!colorProbe) {
      colorProbe = document.createElement('span');
      colorProbe.style.display = 'none';
      document.body.append(colorProbe);
    }
    colorProbe.style.color = `var(${name})`;
    return getComputedStyle(colorProbe).color;
  }

  // ---------- Waveform scope ----------

  /** Draws the waveform of one track and reports peak level or silence. */
  class Scope {
    constructor(canvasId, readoutId) {
      this.canvas = $(canvasId);
      this.readout = $(readoutId);
      this.ctx = null;
      this.raf = 0;
      this.windowPeak = 0;
    }

    /** Highest sample magnitude since the last call (0 when not running). */
    takePeak() {
      const p = this.ctx ? this.windowPeak : 0;
      this.windowPeak = 0;
      return p;
    }

    start(t) {
      this.stop();
      this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') this.ctx.resume();
      const src = this.ctx.createMediaStreamSource(new MediaStream([t]));
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      const loop = () => {
        this.draw();
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    }

    stop() {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      if (this.ctx) this.ctx.close();
      this.ctx = null;
      this.clear();
      this.readout.textContent = 'no audio';
    }

    clear() {
      const c = this.canvas;
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.round(c.clientWidth * dpr);
      c.height = Math.round(90 * dpr);
      const g = c.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.strokeStyle = cssColor('--outline-variant');
      g.beginPath();
      g.moveTo(0, 45);
      g.lineTo(c.clientWidth, 45);
      g.stroke();
      return g;
    }

    draw() {
      this.analyser.getFloatTimeDomainData(this.buf);
      let peak = 0;
      let allZero = true;
      for (const v of this.buf) {
        const a = Math.abs(v);
        if (a > peak) peak = a;
        if (v !== 0) allZero = false;
      }
      const g = this.clear();
      if (peak > this.windowPeak) this.windowPeak = peak;
      const w = this.canvas.clientWidth;
      g.strokeStyle = cssColor(allZero ? '--on-surface-variant' : '--primary');
      g.lineWidth = 1.5;
      g.beginPath();
      const step = this.buf.length / w;
      for (let x = 0; x < w; x++) {
        const y = 45 - this.buf[Math.floor(x * step)] * 42;
        if (x === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.stroke();
      this.readout.textContent = allZero
        ? 'digital silence (all samples 0)'
        : `peak ${(20 * Math.log10(peak)).toFixed(1)} dBFS`;
    }
  }

  const localScope = new Scope('local-scope', 'local-readout');
  const remoteScope = new Scope('remote-scope', 'remote-readout');

  // ---------- RTP stats (getStats, 1 Hz while the loopback runs) ----------

  const SPARK_POINTS = 30;
  let statsTimer = null;
  let prevIn = null;      // previous inbound-rtp report
  let prevOut = null;     // previous outbound-rtp report
  let rtpHistory = [];    // received kbit/s, oldest first
  let lastSignal = null;

  // pps: packets per second. statsLevel: average level from getStats.
  // scopePeak: peak of the received audio measured by this page's waveform,
  // used too because some setups (for example headless Chrome) report 0 energy.
  function classify(pps, statsLevel, scopePeak) {
    if (pps === 0) return 'no RTP';
    if ((statsLevel ?? 0) >= 0.0005 || scopePeak >= 0.001) return 'RTP with audio';
    return 'RTP with silence';
  }

  function drawSpark() {
    const c = $('rtp-spark');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = 60;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!rtpHistory.length) return;
    const max = Math.max(40, ...rtpHistory);
    const bw = w / SPARK_POINTS;
    const x0 = w - rtpHistory.length * bw;
    rtpHistory.forEach((v, i) => {
      const bh = (v / max) * (h - 8);
      g.fillStyle = cssColor(v === 0 ? '--outline-variant' : '--primary');
      g.fillRect(x0 + i * bw + 1, h - Math.max(bh, 1), bw - 2, Math.max(bh, 1));
    });
  }

  async function pollStats() {
    if (!pc2) return;
    let inbound = null;
    let outbound = null;
    for (const r of (await pc2.getStats()).values()) {
      if (r.type === 'inbound-rtp' && r.kind === 'audio') inbound = r;
    }
    if (pc1) {
      for (const r of (await pc1.getStats()).values()) {
        if (r.type === 'outbound-rtp' && r.kind === 'audio') outbound = r;
      }
    }
    if (!inbound && prevIn) {
      // The report can disappear after renegotiation stops reception; treat
      // that as "nothing arrived" since the previous report.
      inbound = { ...prevIn, timestamp: prevIn.timestamp + 1000 };
    }
    if (!inbound) {
      setKv('s-signal', 'no inbound-rtp report yet');
      return;
    }
    let kbps = 0;
    let pps = 0;
    let concealed = 0;
    let silentConcealed = 0;
    let avgLevel;
    if (prevIn) {
      const dt = (inbound.timestamp - prevIn.timestamp) / 1000;
      kbps = dt > 0 ? ((inbound.bytesReceived - prevIn.bytesReceived) * 8) / dt / 1000 : 0;
      pps = dt > 0 ? Math.round((inbound.packetsReceived - prevIn.packetsReceived) / dt) : 0;
      concealed = (inbound.concealedSamples || 0) - (prevIn.concealedSamples || 0);
      silentConcealed = (inbound.silentConcealedSamples || 0) - (prevIn.silentConcealedSamples || 0);
      // Average level over the interval from totalAudioEnergy and
      // totalSamplesDuration. audioLevel is only a snapshot that misses short
      // sounds (for example the fake device's beeps), so it is the fallback.
      const dEnergy = (inbound.totalAudioEnergy ?? 0) - (prevIn.totalAudioEnergy ?? 0);
      const dDuration = (inbound.totalSamplesDuration ?? 0) - (prevIn.totalSamplesDuration ?? 0);
      avgLevel = dDuration > 0 ? Math.sqrt(Math.max(dEnergy, 0) / dDuration) : inbound.audioLevel;
    }
    let sentKbps = null;
    if (outbound && prevOut) {
      const dt = (outbound.timestamp - prevOut.timestamp) / 1000;
      sentKbps = dt > 0 ? ((outbound.bytesSent - prevOut.bytesSent) * 8) / dt / 1000 : 0;
    }
    const first = !prevIn;
    prevIn = inbound;
    prevOut = outbound;
    if (first) return; // need two reports for rates

    rtpHistory.push(kbps);
    if (rtpHistory.length > SPARK_POINTS) rtpHistory.shift();
    drawSpark();

    const level = avgLevel;
    const scopePeak = remoteScope.takePeak();
    const signal = classify(pps, level, scopePeak);
    $('rtp-signal').textContent = `${signal} \u00b7 ${kbps.toFixed(1)} kbit/s`;
    setKv('s-signal', signal, signal === 'no RTP' ? 'nothing arrives; the track should be muted'
        : signal === 'RTP with silence' ? 'packets arrive, but the audio is silent' : 'packets with sound arrive');
    setKv('s-recv-bitrate', `${kbps.toFixed(1)} kbit/s`, `${inbound.bytesReceived} bytes total`);
    setKv('s-pps', String(pps), `${inbound.packetsReceived} packets total, ${inbound.packetsLost ?? 0} lost`);
    setKv('s-sent-bitrate', sentKbps === null ? '—' : `${sentKbps.toFixed(1)} kbit/s`, 'outbound-rtp on the sending side');
    const fmtDb = (v) => (v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : 'silent');
    setKv('s-level', level === undefined ? 'undefined' : `${fmtDb(level)} (getStats)`,
        `waveform peak ${fmtDb(scopePeak)}; getStats average from totalAudioEnergy, snapshot audioLevel ${inbound.audioLevel?.toFixed(4) ?? 'n/a'}`);
    setKv('s-concealed', String(concealed), `last second; ${silentConcealed} of them silent`);
    dbg.group(`getStats: ${signal}, ${kbps.toFixed(1)} kbit/s, ${pps} pkt/s`, { inbound, outbound, kbps, pps, sentKbps });

    if (signal !== lastSignal) {
      log.add('rtp', `${lastSignal ? `${lastSignal} \u2192 ` : ''}${signal} (${kbps.toFixed(1)} kbit/s, ${pps} pkt/s)`);
      lastSignal = signal;
    }
  }

  function startStats() {
    stopStats();
    // getStats() can reject if the loopback closes during the call; ignore that.
    const tick = () => pollStats().catch((err) => dbg('getStats() failed', err));
    statsTimer = setInterval(tick, 1000);
    tick();
  }

  function stopStats() {
    clearInterval(statsTimer);
    statsTimer = null;
    prevIn = null;
    prevOut = null;
    rtpHistory = [];
    lastSignal = null;
    drawSpark();
    $('rtp-signal').textContent = 'no stats';
    for (const id of ['s-signal', 's-recv-bitrate', 's-pps', 's-sent-bitrate', 's-level', 's-concealed']) setKv(id, '—');
  }

  // ---------- Support ----------

  function renderSupport() {
    const proto = window.MediaStreamTrack ? MediaStreamTrack.prototype : {};
    $('support-row').replaceChildren(
      hasGum ? chip('getUserMedia() available', 'ok', 'check_circle') : chip('getUserMedia() not available', 'bad', 'cancel'),
      window.isSecureContext ? chip('Secure context', 'ok', 'lock') : chip('Not a secure context', 'bad', 'lock_open'),
      'muted' in proto ? chip('MediaStreamTrack.muted', 'ok', 'check_circle') : chip('MediaStreamTrack.muted missing', 'bad', 'cancel'),
      typeof window.RTCPeerConnection !== 'undefined' ? chip('RTCPeerConnection available', 'ok', 'check_circle') : chip('RTCPeerConnection not available', 'warn', 'cancel'),
      debugChip(),
    );
  }

  // ---------- Rendering ----------

  function renderLocal() {
    const t = track;
    const value = !t ? '—' : t.readyState === 'ended' ? 'ended' : t.muted ? 'muted' : !t.enabled ? 'disabled' : 'live';
    $('local-value').textContent = value;
    $('local-unit').textContent = !t ? '' : t.readyState === 'ended' ? 'source gone' : t.muted ? 'source can\u2019t provide audio' : !t.enabled ? 'app sends silence' : 'audio flowing';
    const icon = $('local-icon');
    icon.textContent = !t || t.readyState === 'ended' || t.muted || !t.enabled ? 'mic_off' : 'mic';
    icon.dataset.state = t && !t.muted && t.enabled && t.readyState === 'live' ? '' : 'idle';
    setKv('v-muted', t ? String(t.muted) : '—', t && t.muted ? 'set by the browser' : '');
    setKv('v-enabled', t ? String(t.enabled) : '—', t && !t.enabled ? 'set by this page' : '');
    setKv('v-ready', t ? t.readyState : '—');
    setKv('v-label', t ? t.label || '(no label)' : '—');
    setKv('v-mute-count', `${localCounts.mute} mute, ${localCounts.unmute} unmute`, 'events fired on this track since it started');
    setToggle($('enable-btn'), !t || t.readyState === 'ended', t && !t.enabled, 'Enable track', 'Disable track');
    $('loopback-btn').disabled = !t && !pc1;
  }

  function renderRemote() {
    const r = remoteTrack;
    setKv('r-muted', r ? String(r.muted) : '—', r ? (r.muted ? 'no RTP arriving' : 'RTP arriving') : '');
    setKv('r-enabled', r ? String(r.enabled) : '—', r && !r.enabled ? 'set by this page; playout silent' : '');
    setKv('r-ready', r ? r.readyState : '—');
    setKv('r-mute-count', `${remoteCounts.mute} mute, ${remoteCounts.unmute} unmute`, 'events since the track arrived; it starts muted without an event');
    setKv('r-conn', pc2 ? pc2.connectionState : 'not started', sendingPaused ? 'sender transceiver inactive' : '');
    const live = !!r && r.readyState === 'live';
    setToggle($('r-enable-btn'), !live, r && !r.enabled, 'Enable received track', 'Disable received track');
    const pb = $('r-pause-btn');
    pb.disabled = !live;
    pb.querySelector('.icon').textContent = sendingPaused ? 'play_arrow' : 'pause';
    pb.querySelector('.label').textContent = sendingPaused ? 'Resume sending (renegotiate)' : 'Stop sending (renegotiate)';
    $('r-listen').disabled = !live;
  }

  function setToggle(btn, disabled, isOff, offLabel, onLabel) {
    btn.disabled = disabled;
    btn.querySelector('.icon').textContent = isOff ? 'toggle_off' : 'toggle_on';
    btn.querySelector('.label').textContent = isOff ? offLabel : onLabel;
  }

  function touch() {
    $('v-updated').textContent = new Date().toLocaleTimeString();
  }

  // ---------- Log ----------

  const trackState = (t) => (t ? { enabled: t.enabled, muted: t.muted, readyState: t.readyState, label: t.label } : null);

  const log = createLog({
    api: 'MediaStreamTrack muted',
    spec: 'https://w3c.github.io/mediacapture-main/#dom-mediastreamtrack-muted',
    filePrefix: 'track-muted-log',
    snapshot: () => ({
      local: trackState(track),
      remote: trackState(remoteTrack),
      connection: pc2 ? pc2.connectionState : null,
      sendingPaused,
      listening: $('r-listen').checked,
    }),
    dbg,
    extra: () => ({ trackSettings: track ? track.getSettings() : null }),
  });

  // ---------- Microphone ----------

  function watchLocal(t) {
    for (const type of ['mute', 'unmute', 'ended']) {
      t.addEventListener(type, (ev) => {
        if (type !== 'ended') localCounts[type]++;
        dbg.group(`local track event: ${type}`, { event: ev, timeStamp: ev.timeStamp, state: trackState(t), settings: t.getSettings() });
        renderLocal();
        touch();
        log.add(`mic ${type}`, `muted=${t.muted}, enabled=${t.enabled}, readyState=${t.readyState}`);
      });
    }
  }

  async function fillDevices() {
    const sel = $('device-select');
    const keep = sel.value;
    const devices = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    sel.replaceChildren(new Option('Default microphone', ''));
    for (const d of devices) {
      if (d.deviceId === 'default' || d.deviceId === 'communications') continue;
      sel.append(new Option(d.label || `Microphone ${sel.length}`, d.deviceId));
    }
    sel.value = [...sel.options].some((o) => o.value === keep) ? keep : '';
  }

  async function startMic() {
    const deviceId = $('device-select').value;
    const constraints = { audio: deviceId ? { deviceId: { exact: deviceId } } : true };
    dbg('getUserMedia()', constraints);
    try {
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      dbg('getUserMedia() failed', err);
      log.add('error', `getUserMedia() failed: ${err.name}: ${err.message}`);
      return;
    }
    track = stream.getAudioTracks()[0];
    dbg.group('getUserMedia() resolved', { state: trackState(track), settings: track.getSettings() });
    watchLocal(track);
    localScope.start(track);
    log.add('getUserMedia()', `"${track.label}", muted=${track.muted}, readyState=${track.readyState}`);
    setMicButton(true);
    renderLocal();
    touch();
    fillDevices();
  }

  function stopMic() {
    stopLoopback();
    if (stream) stream.getTracks().forEach((t) => t.stop());
    dbg('track.stop() called');
    log.add('stop()', 'microphone track stopped by the page (no ended event for stop())');
    localScope.stop();
    stream = null;
    track = null;
    setMicButton(false);
    renderLocal();
  }

  function setMicButton(on) {
    const b = $('mic-btn');
    b.querySelector('.icon').textContent = on ? 'stop' : 'mic';
    b.querySelector('.label').textContent = on ? 'Stop microphone' : 'Start microphone';
    $('device-select').disabled = on;
  }

  function toggleEnabled() {
    if (!track) return;
    track.enabled = !track.enabled;
    dbg(`microphone track.enabled = ${track.enabled}`);
    log.add('mic enabled', `track.enabled = ${track.enabled} (muted stays ${track.muted})`);
    renderLocal();
    touch();
  }

  // ---------- WebRTC loopback ----------

  async function negotiate() {
    const offer = await pc1.createOffer();
    await pc1.setLocalDescription(offer);
    await pc2.setRemoteDescription(offer);
    const answer = await pc2.createAnswer();
    await pc2.setLocalDescription(answer);
    await pc1.setRemoteDescription(answer);
  }

  async function startLoopback() {
    pc1 = new RTCPeerConnection();
    pc2 = new RTCPeerConnection();
    pc1.onicecandidate = (e) => e.candidate && pc2.addIceCandidate(e.candidate);
    pc2.onicecandidate = (e) => e.candidate && pc1.addIceCandidate(e.candidate);
    pc2.onconnectionstatechange = () => {
      dbg(`pc2 connectionState: ${pc2 && pc2.connectionState}`);
      renderRemote();
    };
    pc2.ontrack = (e) => {
      if (e.track === remoteTrack) {
        // Renegotiation that restores receiving fires ontrack again for the
        // same track; keep the existing listeners, playout, and scope.
        dbg('pc2 ontrack fired again for the same track (renegotiation)');
        return;
      }
      remoteTrack = e.track;
      dbg.group('pc2 ontrack', { state: trackState(remoteTrack) });
      log.add('remote track', `received, muted=${remoteTrack.muted}`);
      for (const type of ['mute', 'unmute', 'ended']) {
        remoteTrack.addEventListener(type, (ev) => {
          if (type !== 'ended') remoteCounts[type]++;
          dbg.group(`remote track event: ${type}`, { event: ev, state: trackState(remoteTrack) });
          renderRemote();
          log.add(`remote ${type}`, `muted=${remoteTrack.muted}, readyState=${remoteTrack.readyState}`);
        });
      }
      // Chrome only delivers received WebRTC audio to Web Audio while the
      // stream is also attached to a media element, so always attach one.
      remoteAudio = new Audio();
      remoteAudio.srcObject = new MediaStream([remoteTrack]);
      remoteAudio.muted = !$('r-listen').checked;
      remoteAudio.play().catch((err) => dbg('remote audio play() failed', err));
      remoteScope.start(remoteTrack);
      renderRemote();
    };
    pc1.addTrack(track, stream);
    await negotiate();
    sendingPaused = false;
    log.add('loopback', 'pc1 \u2192 pc2 connected locally');
    startStats();
    setLoopbackButton(true);
    renderRemote();
  }

  function stopLoopback() {
    if (!pc1) return;
    stopStats();
    remoteScope.stop();
    if (remoteAudio) {
      remoteAudio.srcObject = null;
      remoteAudio = null;
    }
    pc1.close();
    pc2.close();
    dbg('Loopback closed');
    log.add('loopback', 'closed');
    pc1 = null;
    pc2 = null;
    sendingPaused = false;
    $('r-listen').checked = false;
    setLoopbackButton(false);
    renderRemote();
    renderLocal();
  }

  function setLoopbackButton(on) {
    $('loopback-btn').querySelector('.label').textContent = on ? 'Stop WebRTC loopback' : 'Start WebRTC loopback';
  }

  function toggleRemoteEnabled() {
    if (!remoteTrack) return;
    remoteTrack.enabled = !remoteTrack.enabled;
    dbg(`received track.enabled = ${remoteTrack.enabled}`);
    log.add('remote enabled', `received track.enabled = ${remoteTrack.enabled} (muted stays ${remoteTrack.muted}; sender not told)`);
    renderRemote();
  }

  async function toggleSending() {
    if (!pc1) return;
    const transceiver = pc1.getTransceivers()[0];
    const next = sendingPaused ? 'sendonly' : 'inactive';
    transceiver.direction = next;
    dbg(`pc1 transceiver.direction = "${next}", renegotiating`);
    await negotiate();
    sendingPaused = !sendingPaused;
    log.add('renegotiate', `sender transceiver direction = ${next}${sendingPaused ? ' (expect remote mute)' : ' (expect remote unmute on first RTP)'}`);
    renderRemote();
  }

  function toggleListen() {
    const on = $('r-listen').checked;
    if (remoteAudio) remoteAudio.muted = !on;
    dbg(`Listen ${on ? 'on' : 'off'}`);
    log.add('listen', on ? 'playing the received track (use headphones)' : 'stopped playing the received track');
  }

  // ---------- Init ----------

  function init() {
    renderSupport();
    $('mic-btn').disabled = !hasGum;
    $('mic-btn').addEventListener('click', () => (track ? stopMic() : startMic()));
    $('enable-btn').addEventListener('click', toggleEnabled);
    $('loopback-btn').addEventListener('click', () => (pc1 ? stopLoopback() : track && startLoopback()));
    $('r-enable-btn').addEventListener('click', toggleRemoteEnabled);
    $('r-pause-btn').addEventListener('click', toggleSending);
    $('r-listen').addEventListener('change', toggleListen);
    if (hasGum) {
      navigator.mediaDevices.addEventListener('devicechange', async () => {
        const devices = await navigator.mediaDevices.enumerateDevices();
        dbg.group('devicechange', devices.map((d) => ({ kind: d.kind, label: d.label })));
        log.add('devicechange', `${devices.filter((d) => d.kind === 'audioinput').length} audio inputs`);
        fillDevices();
      });
    }
    localScope.clear();
    remoteScope.clear();
    renderLocal();
    renderRemote();
    mountSystemDiagnostics(dbg);
  }

  init();
})();
