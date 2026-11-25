// Audio Session API demo: navigator.audioSession type and state, statechange
// events, and audio/microphone test sources. Event driven; no polling.
'use strict';

(() => {
  const { $, chip, setKv, createLog, createDebug, debugChip, mountSystemDiagnostics } = window.DemoKit;
  const dbg = createDebug('audio-session');
  const session = navigator.audioSession || null;
  const audio = $('test-audio');
  // Marks test-source log entries when no session exists to react to them.
  const NO_SESSION = session ? '' : ' (no audio session in this browser)';
  let micStream = null;
  let stateChanges = 0;
  let previousState = session ? session.state : null;

  const STATE_TEXT = {
    inactive: 'no audio playing or capturing',
    active: 'the page is playing or capturing audio',
    interrupted: 'the OS paused the page\u2019s audio (for example a call)',
  };

  function renderSupport() {
    const chips = [
      session ? chip('navigator.audioSession available', 'ok', 'check_circle')
              : chip('navigator.audioSession not available', 'bad', 'cancel', 'Not implemented in this browser. See "Why isn\u2019t it in Chrome?" below.'),
      window.isSecureContext ? chip('Secure context', 'ok', 'lock')
                             : chip('Not a secure context', 'bad', 'lock_open'),
    ];
    if (session) {
      chips.push('onstatechange' in session ? chip('statechange event supported', 'ok', 'notifications')
                                            : chip('statechange event not supported', 'warn', 'notifications_off'));
    }
    chips.push(debugChip());
    $('support-row').replaceChildren(...chips);
    dbg.group('Support checks', {
      audioSession: session,
      type: session ? session.type : undefined,
      state: session ? session.state : undefined,
      userAgent: navigator.userAgent,
    });
  }

  function render() {
    const st = session ? session.state : null;
    $('state-value').textContent = st || 'not available';
    $('state-unit').textContent = st ? `type ${session.type}` : 'in this browser';
    const icon = $('state-icon');
    icon.textContent = st === 'interrupted' ? 'pause_circle' : st === 'active' ? 'graphic_eq' : 'volume_off';
    icon.dataset.state = st || 'idle';
    setKv('v-state', st ?? 'undefined', st ? STATE_TEXT[st] || '' : 'navigator.audioSession is undefined');
    setKv('v-type', session ? session.type : 'undefined');
    setKv('v-count', String(stateChanges));
    setKv('v-audio', audio.paused ? 'stopped' : 'playing', audio.paused ? '' : 'far_end_speech.wav, looped');
    setKv('v-mic', micStream ? 'on' : 'off', micStream ? micStream.getAudioTracks()[0]?.label || '' : '');
    $('v-updated').textContent = new Date().toLocaleTimeString();
  }

  function snapshot() {
    return {
      state: session ? session.state : null,
      type: session ? session.type : null,
      audioPlaying: !audio.paused,
      microphone: !!micStream,
    };
  }

  const log = createLog({
    api: 'Audio Session',
    spec: 'https://w3c.github.io/audio-session/',
    filePrefix: 'audio-session-log',
    snapshot,
    dbg,
  });

  function setType(value) {
    if (!session) return;
    const before = session.type;
    try {
      session.type = value;
    } catch (err) {
      dbg('Setting type failed', err);
      log.add('error', `type = "${value}" failed: ${err.name}: ${err.message}`);
      return;
    }
    dbg(`type "${before}" -> "${session.type}" (requested "${value}")`);
    log.add('type', `${before} \u2192 ${session.type}`);
    render();
  }

  async function togglePlay() {
    const btn = $('play-btn');
    if (audio.paused) {
      // Ignore clicks until play() settles, so a second click can't abort it.
      btn.disabled = true;
      try {
        await audio.play();
        dbg('Test audio playing');
        log.add('audio', `play()${NO_SESSION}`);
      } catch (err) {
        dbg('audio.play() failed', err);
        log.add('error', `audio.play() failed: ${err.name}: ${err.message}`);
      }
      btn.disabled = false;
    } else {
      audio.pause();
      dbg('Test audio paused');
      log.add('audio', `pause()${NO_SESSION}`);
    }
    btn.querySelector('.icon').textContent = audio.paused ? 'play_arrow' : 'stop';
    btn.querySelector('.label').textContent = audio.paused ? 'Play audio' : 'Stop audio';
    render();
  }

  async function toggleMic() {
    const btn = $('mic-btn');
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
      dbg('Microphone stopped');
      log.add('microphone', `tracks stopped${NO_SESSION}`);
    } else {
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const track = micStream.getAudioTracks()[0];
        dbg('getUserMedia() resolved', { label: track.label, settings: track.getSettings() });
        log.add('microphone', `getUserMedia() started "${track.label}"${NO_SESSION}`);
      } catch (err) {
        dbg('getUserMedia() failed', err);
        log.add('error', `getUserMedia() failed: ${err.name}: ${err.message}`);
      }
    }
    btn.querySelector('.icon').textContent = micStream ? 'mic_off' : 'mic';
    btn.querySelector('.label').textContent = micStream ? 'Stop microphone' : 'Start microphone';
    render();
  }

  function init() {
    renderSupport();
    const select = $('type-select');
    if (session) {
      select.value = session.type;
      select.addEventListener('change', () => setType(select.value));
      session.addEventListener('statechange', (ev) => {
        stateChanges++;
        dbg.group('event: statechange', { event: ev, timeStamp: ev.timeStamp, isTrusted: ev.isTrusted, previous: previousState, current: session.state, type: session.type });
        log.add('statechange', `${previousState} \u2192 ${session.state} (type ${session.type})`);
        previousState = session.state;
        render();
      });
      log.add('initial', `state=${session.state}, type=${session.type}`);
    } else {
      select.disabled = true;
      log.add('unsupported', 'navigator.audioSession is undefined');
    }
    $('play-btn').addEventListener('click', togglePlay);
    $('mic-btn').addEventListener('click', toggleMic);
    audio.addEventListener('ended', render);
    render();
    mountSystemDiagnostics(dbg);
  }

  init();
})();
