'use strict';

document.addEventListener('DOMContentLoaded', async () => {
  const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  console.log('Supported constraints:', supportedConstraints);
  const isVoiceIsolationSupported = !!supportedConstraints.voiceIsolation;
  const gumButton = document.getElementById('gum-button');
  const applyConstraintsButton = document.getElementById('apply-constraints-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const voiceIsolationContainer = document.getElementById('voiceIsolation-container');
  const voiceIsolationSelect = document.getElementById('voiceIsolation');
  if (isVoiceIsolationSupported && voiceIsolationContainer) {
    voiceIsolationContainer.style.display = '';
  }
  const channelCountSelect = document.getElementById('channelCount');
  const latencyConstraintSelect = document.getElementById('latencyConstraint');
  const sampleRateConstraintSelect = document.getElementById('sampleRateConstraint');
  const sampleSizeConstraintSelect = document.getElementById('sampleSizeConstraint');
  const errorMessageElement = document.getElementById('error-message');
  const audioDeviceSelect = document.querySelector('#audioDevice');
  const audioOutputDeviceSelect = document.querySelector('#audioOutputDevice');
  const latencyHintSelect = document.querySelector('#latencyHint');
  const sampleRateSelect = document.querySelector('#sampleRate');
  
  const visualizerCanvas = document.querySelector('#audio-visualizer');
  const canvasCtx = visualizerCanvas.getContext('2d');
  const stopButton = document.querySelector('#stop-button');
  const recordButton = document.querySelector('#record-button');
  const streamControlsContainer = document.querySelector('#stream-controls-container');
  const muteCheckbox = document.querySelector('#mute-checkbox');
  const htmlPlayCheckbox = document.querySelector('#html-play-checkbox');
  const webaudioPlayCheckbox = document.querySelector('#webaudio-play-checkbox');
  const audioPlayback = document.querySelector('#audio-playback');
  const fileSourceAudio = document.querySelector('#file-source-audio');
  const trackSettingsElement = document.querySelector('#track-settings');
  const trackPropertiesElement = document.querySelector('#track-properties');
  const trackStatsElement = document.querySelector('#track-stats');
  const trackConstraintsElement = document.querySelector('#track-constraints');
  const audioInputDeviceElement = document.querySelector('#audio-input-device');
  const audioOutputInfoElement = document.querySelector('#audio-output-info');
  const audioDevicesContainer = document.querySelector('#audio-devices-container');
  const recordedAudioContainer = document.querySelector('#recorded-audio-container');
  const recordedAudio = document.querySelector('#recorded-audio');
  const downloadRecordedAudioButton = document.querySelector('#download-recorded-audio-button');
  const recordedVisualizer = document.querySelector('#recorded-visualizer');
  let lastRecordedBlob = null;
  let lastRecordedMimeType = '';
  const copyBookmarkButton = document.getElementById('copy-bookmark-button');
  const bookmarkUrlContainer = document.getElementById('bookmark-url-container');
  const saveSnapshotButton = document.getElementById('save-snapshot-button');
  const snapshotButtonContainer = document.getElementById('snapshot-button-container');
  const peerConnectionCheckbox = document.getElementById('peerconnection-checkbox');
  const dtxCheckbox = document.getElementById('dtx-checkbox');
  const autoRecordCheckbox = document.getElementById('auto-record-checkbox');
  const autoRecordLabel = document.querySelector('label[for="auto-record-checkbox"]');
  const micSourceRadio = document.getElementById('mic-source');
  const fileSourceRadio = document.getElementById('file-source');
  const fileSelectionContainer = document.getElementById('file-selection-container');
  const audioFileSelect = document.getElementById('audioFile');
  const localFileInput = document.getElementById('localFileInput');
  const settingsContainer = document.querySelector('.settings-container');
  const outboundRtpStatsElement = document.getElementById('outbound-rtp-stats');
  const rtpStatsSectionContainer = document.getElementById('rtp-stats-section-container');

  const audioFiles = [
    'concatenate_female.wav',
    'harvard.wav',
    'stereo_knocking.wav',
    'music_beat.wav',
    'female_singer_48k.wav',
    'concatenate_female_plus_3dB.wav',
    'concatenate_female_plus_2dB.wav',
    'concatenate_female_plus_1dB.wav',
    'concatenate_female_minus_5dB.wav',
    'concatenate_female_minus_10dB.wav',
    'concatenate_female_minus_20dB.wav',
    'concatenate_female_minus_30dB.wav',
    'concatenate_female_minus_40dB.wav',
    'concatenate_female_minus_50dB.wav',
  ];

  audioFiles.forEach(file => {
    const option = new Option(file, file);
    audioFileSelect.appendChild(option);
  });

  audioFileSelect.addEventListener('change', () => {
    currentFileSourceType = 'predefined';
    // Optional: Clear local file input value to visually indicate it's not active
    localFileInput.value = '';
  });

  localFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
      currentFileSourceType = 'local';
      if (localFileBlobUrl) {
        URL.revokeObjectURL(localFileBlobUrl);
      }
      localFileBlobUrl = URL.createObjectURL(file);
      localFileName = file.name;
    }
  });

  const inboundRtpStatsElement = document.getElementById('inbound-rtp-stats');
  const audioPlayoutStatsElement = document.getElementById('audio-playout-stats');

  let localStream;
  let streamForPlaybackAndVisualizer;
  let audioContext;
  let analyser;
  let isRecording = false;
  let mediaRecorder;
  let recordedChunks = [];
  let recordedAudioContext;
  let recordedAnalyser;
  let recordedSourceNode;
  let recordedVisualizationFrameRequest;
  let fileProgressFrameRequest;
  let webAudioContext;
  let webAudioSource;
  let statsInterval;
  let previousStats = null;
  let previousTrackProperties = null;
  let pc1, pc2;
  let previousOutboundRtpStats = null;
  let previousInboundRtpStats = null;
  let previousPlayoutStats = null;
  let rmsAudioLevels = [];
  let latestRmsAudioLevel = null;
  let total_intervals = 0;
  let glitchy_intervals = 0;
  let currentFileSourceType = 'predefined'; // 'predefined' or 'local'
  let localFileBlobUrl = null;
  let localFileName = '';
  let previousAudioInputsCount = null;
  let previousAudioOutputsCount = null;
  let audioInputsHighlightExpiry = 0;
  let audioOutputsHighlightExpiry = 0;
  let audioInputsFadeTimer = null;
  let audioOutputsFadeTimer = null;
  const lifecycleEvents = [];

  let computePressureObserver = null;
  let latestComputePressure = { state: 'Unknown', factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
  let simulationTimer = null;
  const computePressureHistory = [];
  const MAX_PRESSURE_HISTORY_POINTS = 30;

  function getComputePressureValue(state) {
    switch (state) {
      case 'nominal': return 25;
      case 'fair': return 50;
      case 'serious': return 75;
      case 'critical': return 100;
      default: return 25;
    }
  }

  function getComputePressureColor(state) {
    switch (state) {
      case 'nominal': return '#2E7D32'; // Green (light)
      case 'fair': return '#F57F17';    // Yellow/Amber (moderate)
      case 'serious': return '#E65100'; // Orange (high)
      case 'critical': return '#C62828';// Red (heavy)
      default: return '#757575';
    }
  }

  function addComputePressureHistoryPoint(state, factors = [], isSimulated = false) {
    const val = getComputePressureValue(state);
    computePressureHistory.push({
      time: Date.now(),
      state: state,
      value: val,
      factors: factors || [],
      isSimulated: isSimulated
    });
    if (computePressureHistory.length > MAX_PRESSURE_HISTORY_POINTS) {
      computePressureHistory.shift();
    }
    renderComputePressureGraph();
  }

  function renderComputePressureGraph() {
    const canvas = document.getElementById('compute-pressure-canvas');
    if (!canvas) return;
    const container = document.getElementById('compute-pressure-graph-container');
    if (container) {
      const containerW = Math.floor(container.clientWidth - 18);
      if (containerW > 100 && canvas.width !== containerW) {
        canvas.width = containerW;
      }
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;

    // Background
    ctx.fillStyle = '#fafbfc';
    ctx.fillRect(0, 0, width, height);

    // Padding for axes
    const padLeft = 82;
    const padRight = 14;
    const padTop = 10;
    const padBottom = 16;
    const plotW = width - padLeft - padRight;
    const plotH = height - padTop - padBottom;

    // Levels mapping according to Google Meet Web design
    const levels = [
      { label: 'heavy (100%)', val: 100, color: '#C62828' },
      { label: 'high (75%)', val: 75, color: '#E65100' },
      { label: 'moderate (50%)', val: 50, color: '#F57F17' },
      { label: 'light (25%)', val: 25, color: '#2E7D32' },
    ];

    // Draw horizontal grid lines and level labels
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.font = '9px "Lucida Console", monospace';

    levels.forEach(lvl => {
      // Linear mapping: 20% to 105% onto plot area
      const y = padTop + plotH - ((lvl.val - 20) / 85) * plotH;
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(padLeft, y);
      ctx.lineTo(padLeft + plotW, y);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = lvl.color;
      ctx.fillText(lvl.label, padLeft - 6, y);
    });

    // Time axis marks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#888';
    ctx.fillText('-30s', padLeft, padTop + plotH + 3);
    ctx.fillText('-15s', padLeft + plotW / 2, padTop + plotH + 3);
    ctx.fillText('now', padLeft + plotW, padTop + plotH + 3);

    if (computePressureHistory.length === 0) return;

    // Prepare point coordinates
    const n = computePressureHistory.length;
    const stepX = plotW / (MAX_PRESSURE_HISTORY_POINTS - 1);
    const startX = padLeft + (MAX_PRESSURE_HISTORY_POINTS - n) * stepX;

    const points = computePressureHistory.map((pt, i) => {
      const x = startX + i * stepX;
      const y = padTop + plotH - ((pt.value - 20) / 85) * plotH;
      return { x, y, state: pt.state, val: pt.value, color: getComputePressureColor(pt.state) };
    });

    if (points.length === 1) {
      ctx.fillStyle = points[0].color;
      ctx.beginPath();
      ctx.arc(points[0].x, points[0].y, 4, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Step-line path for area and stroke (preserving discrete state shifts)
    const stepPoints = [];
    stepPoints.push({ x: points[0].x, y: points[0].y, color: points[0].color });
    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      stepPoints.push({ x: curr.x, y: prev.y, color: prev.color });
      stepPoints.push({ x: curr.x, y: curr.y, color: curr.color });
    }

    // Draw shaded area under curve
    ctx.beginPath();
    ctx.moveTo(stepPoints[0].x, padTop + plotH);
    for (let i = 0; i < stepPoints.length; i++) {
      ctx.lineTo(stepPoints[i].x, stepPoints[i].y);
    }
    ctx.lineTo(stepPoints[stepPoints.length - 1].x, padTop + plotH);
    ctx.closePath();

    const lastPt = points[points.length - 1];
    const grad = ctx.createLinearGradient(0, padTop, 0, padTop + plotH);
    grad.addColorStop(0, `${lastPt.color}33`);
    grad.addColorStop(1, `${lastPt.color}05`);
    ctx.fillStyle = grad;
    ctx.fill();

    // Draw step line segments
    for (let i = 0; i < stepPoints.length - 1; i++) {
      const p1 = stepPoints[i];
      const p2 = stepPoints[i + 1];
      ctx.strokeStyle = p2.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
    }

    // Draw markers at actual samples
    points.forEach((p, idx) => {
      ctx.fillStyle = p.color;
      ctx.beginPath();
      const isLatest = (idx === points.length - 1);
      ctx.arc(p.x, p.y, isLatest ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      if (isLatest) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    });
  }

  // 1Hz timeline update timer to keep the history graph rolling smoothly
  setInterval(() => {
    if (latestComputePressure.state !== 'Unknown') {
      addComputePressureHistoryPoint(latestComputePressure.state, latestComputePressure.factors, latestComputePressure.isSimulated);
    }
  }, 1000);

  function setComputePressureState(newState, factors = [], isSimulated = false) {
    const prevState = latestComputePressure.state;
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0];

    latestComputePressure = {
      state: newState,
      factors: factors || [],
      sampleCount: (latestComputePressure.sampleCount || 0) + 1,
      lastSampleTime: timeStr,
      time: now.toISOString(),
      isSimulated: isSimulated
    };

    addComputePressureHistoryPoint(newState, factors, isSimulated);

    const factorText = factors && factors.length > 0 ? ` (factors: ${factors.join(', ')})` : '';
    const simText = isSimulated ? ' [simulated]' : '';

    if (prevState === 'Unknown') {
      logLifecycleEvent('ComputePressure', `Observer active (initial state: ${newState}${factorText})${simText}`, 'info');
    } else if (prevState !== newState) {
      let level = 'info';
      if (newState === 'critical') level = 'error';
      else if (newState === 'serious') level = 'warning';
      else if (newState === 'nominal') level = 'success';

      logLifecycleEvent('ComputePressure', `CPU pressure transitioned: ${prevState} -> ${newState}${factorText}${simText}`, level);
    }

    updateComputePressureUI();
  }

  function runComputePressureCycle() {
    if (simulationTimer) {
      clearInterval(simulationTimer);
      simulationTimer = null;
    }
    const states = ['nominal', 'fair', 'serious', 'critical', 'serious', 'fair', 'nominal'];
    let idx = 0;
    const btn = document.getElementById('simulate-pressure-cycle-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Simulating Cycle...';
    }

    setComputePressureState(states[idx], idx >= 3 ? ['thermal'] : [], true);

    simulationTimer = setInterval(() => {
      idx++;
      if (idx >= states.length) {
        clearInterval(simulationTimer);
        simulationTimer = null;
        const b = document.getElementById('simulate-pressure-cycle-btn');
        if (b) {
          b.disabled = false;
          b.textContent = 'Simulate Cycle';
        }
        return;
      }
      const state = states[idx];
      const factors = (state === 'serious' || state === 'critical') ? ['thermal'] : [];
      setComputePressureState(state, factors, true);
    }, 1500);
  }

  function getComputePressureBadge(state) {
    switch (state) {
      case 'nominal':
        return '<span style="color: #2E7D32; font-weight: bold;">🟢 Nominal (Light load)</span>';
      case 'fair':
        return '<span style="color: #F57F17; font-weight: bold;">🟡 Fair (Moderate load)</span>';
      case 'serious':
        return '<span style="color: #E65100; font-weight: bold;">🟠 Serious (High load)</span>';
      case 'critical':
        return '<span style="color: #C62828; font-weight: bold;">🔴 Critical (Heavy load)</span>';
      default:
        return `<span style="color: #666;">${state}</span>`;
    }
  }

  function formatComputePressureHtml(pressure) {
    const isSupported = typeof PressureObserver !== 'undefined';
    const stateBadge = getComputePressureBadge(pressure ? pressure.state : 'Unknown');
    const factorsText = (pressure && pressure.factors && pressure.factors.length > 0)
      ? ` <small style="color: #666; font-weight: normal;">[factors: ${pressure.factors.join(', ')}]</small>`
      : '';
    const sampleMeta = (pressure && pressure.lastSampleTime)
      ? ` <small style="color: #777; font-weight: normal;">(last: ${pressure.lastSampleTime}, count: ${pressure.sampleCount}${pressure.isSimulated ? ', simulated' : ''})</small>`
      : '';

    return `${stateBadge}${factorsText}${sampleMeta}`;
  }

  function updateComputePressureUI() {
    const el = document.getElementById('compute-pressure-status');
    if (el) {
      el.innerHTML = formatComputePressureHtml(latestComputePressure);
    }
    const summaryBadge = document.getElementById('summary-compute-pressure-badge');
    if (summaryBadge) {
      if (typeof PressureObserver === 'undefined' && !latestComputePressure.isSimulated) {
        summaryBadge.innerHTML = '<span style="color: #888;">[CPU: N/A]</span>';
      } else if (latestComputePressure.state !== 'Unknown') {
        let icon = '🟢';
        if (latestComputePressure.state === 'fair') icon = '🟡';
        else if (latestComputePressure.state === 'serious') icon = '🟠';
        else if (latestComputePressure.state === 'critical') icon = '🔴';
        summaryBadge.innerHTML = `<span style="color: #555;">[CPU: ${icon} ${latestComputePressure.state.toUpperCase()}${latestComputePressure.isSimulated ? ' (sim)' : ''}]</span>`;
      }
    }
    renderComputePressureGraph();
  }

  async function initComputePressureObserver() {
    if (typeof PressureObserver === 'undefined') {
      console.log('Compute Pressure API (PressureObserver) not supported in this browser.');
      latestComputePressure = { state: 'nominal', factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
      updateComputePressureUI();
      return;
    }
    try {
      computePressureObserver = new PressureObserver((records) => {
        if (!records || records.length === 0) return;
        if (simulationTimer) return; // Do not overwrite active simulated cycle
        const latest = records[records.length - 1];
        setComputePressureState(latest.state, latest.factors || [], false);
      });

      await computePressureObserver.observe('cpu', { sampleInterval: 1000 });
      console.log('Compute Pressure API observer initialized on source "cpu".');
    } catch (err) {
      console.warn('Failed to start PressureObserver:', err);
      latestComputePressure = { state: `Error: ${err.message}`, factors: [], sampleCount: 0, lastSampleTime: null, isSimulated: false };
      updateComputePressureUI();
    }
  }

  function logLifecycleEvent(category, message, level = 'info') {
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');
    const entry = { time: timeStr, category, message, level };
    lifecycleEvents.push(entry);

    const logContainer = document.getElementById('lifecycle-events-log');
    const countSpan = document.getElementById('lifecycle-events-count');

    if (countSpan) {
      countSpan.textContent = `${lifecycleEvents.length} event${lifecycleEvents.length !== 1 ? 's' : ''}`;
    }

    if (logContainer) {
      const line = document.createElement('div');
      line.className = `lifecycle-event-line event-${level}`;

      let marker = '';
      if (level === 'error') marker = '<span class="event-marker">⛔</span>';
      else if (level === 'warning') marker = '<span class="event-marker">⚠️</span>';
      else if (level === 'success') marker = '<span class="event-marker">✅</span>';

      line.innerHTML = `${marker}<span class="event-timestamp">[${timeStr}]</span> <strong>${category}:</strong> ${message}`;
      logContainer.appendChild(line);
      logContainer.scrollTop = logContainer.scrollHeight;
    }
    console.log(`[Lifecycle] [${level.toUpperCase()}] ${timeStr} [${category}] ${message}`);
  }

  function updateAudioFileProgress() {
    const progressBar = document.getElementById('audio-file-progress');
    const timeDisplay = document.getElementById('audio-file-time');
    
    if (progressBar && fileSourceAudio.duration) {
      progressBar.value = (fileSourceAudio.currentTime / fileSourceAudio.duration) * 100;
      if (timeDisplay) {
        timeDisplay.textContent = `time: ${fileSourceAudio.currentTime.toFixed(2)}s / ${fileSourceAudio.duration.toFixed(2)}s`;
      }
      fileProgressFrameRequest = requestAnimationFrame(updateAudioFileProgress);
    }
  }

  function parseWavHeader(arrayBuffer) {
    try {
      const view = new DataView(arrayBuffer);
      // Check for "RIFF"
      if (view.getUint32(0, false) !== 0x52494646) return null; 
      // Check for "WAVE"
      if (view.getUint32(8, false) !== 0x57415645) return null; 
      
      // Search for "fmt " chunk
      let offset = 12;
      while (offset < view.byteLength) {
        const chunkId = view.getUint32(offset, false);
        const chunkSize = view.getUint32(offset + 4, true);
        
        if (chunkId === 0x666d7420) { // "fmt "
          const audioFormat = view.getUint16(offset + 8, true);
          const numChannels = view.getUint16(offset + 10, true);
          const sampleRate = view.getUint32(offset + 12, true);
          const byteRate = view.getUint32(offset + 16, true);
          const blockAlign = view.getUint16(offset + 20, true);
          const bitsPerSample = view.getUint16(offset + 22, true);
          
          let formatString = 'Unknown';
          switch (audioFormat) {
            case 1: formatString = 'PCM'; break;
            case 3: formatString = 'IEEE Float'; break;
            case 6: formatString = 'A-Law'; break;
            case 7: formatString = 'Mu-Law'; break;
            case 0xFFFE: formatString = 'Extensible'; break;
            default: formatString = `Format ${audioFormat}`;
          }

          return { 
            audioFormat: formatString,
            sampleRate, 
            numberOfChannels: numChannels, 
            byteRate,
            blockAlign,
            bitsPerSample 
          };
        }
        
        offset += 8 + chunkSize;
      }
    } catch (e) {
      console.error('Error parsing WAV header:', e);
    }
    return null;
  }

  async function getAudioFileMetadata(source) {
    try {
      const response = await fetch(source);
      const arrayBuffer = await response.arrayBuffer();
      
      // Try to parse WAV header first for accurate sample rate
      const wavData = parseWavHeader(arrayBuffer);
      if (wavData) {
        console.log('Got metadata from WAV header:', wavData);
        return wavData;
      }

      // Fallback to decodeAudioData (might be resampled)
      // Use OfflineAudioContext to decode without affecting main audio context
      const tempCtx = new OfflineAudioContext(1, 1, 44100);
      const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
      return {
        sampleRate: audioBuffer.sampleRate + ' (resampled)',
        numberOfChannels: audioBuffer.numberOfChannels,
        bitsPerSample: 'Unknown (float32)'
      };
    } catch (e) {
      console.error('Error getting file metadata:', e);
      return null;
    }
  }

  /**
   * Sets up a local WebRTC loopback connection between two RTCPeerConnection objects.
   * @param {MediaStream} stream The local audio stream to send through the connection.
   * @returns {Promise<MediaStream>} A promise that resolves with the remote stream.
   */
  async function setupPeerConnection(stream) {
    console.log('Setting up PeerConnection.');
    pc1 = new RTCPeerConnection();
    pc2 = new RTCPeerConnection();

    const [localTrack] = stream.getAudioTracks();
    pc1.addTrack(localTrack, stream);

    const remoteStreamPromise = new Promise((resolve) => {
      pc2.ontrack = (event) => {
        console.log('pc2 received remote track.');
        resolve(event.streams[0]);
      };
    });

    exchangeIceCandidates(pc1, pc2);

    pc1.oniceconnectionstatechange = () => console.log(`pc1 ICE state: ${pc1.iceConnectionState}`);
    pc2.oniceconnectionstatechange = () => console.log(`pc2 ICE state: ${pc2.iceConnectionState}`);

    try {
      const offer = await pc1.createOffer();
      console.log('pc1 offer SDP:\n', offer.sdp);
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);

      const answer = await pc2.createAnswer();
      console.log('pc2 original answer SDP:\n', answer.sdp);
      answer.sdp = insertStereoSupportForOpus(answer.sdp);
      if (dtxCheckbox.checked) {
        answer.sdp = insertDtxSupportForOpus(answer.sdp);
      }
      console.log('pc2 modified answer SDP:\n', answer.sdp);
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      console.log('PeerConnection offer-answer exchange complete.');
    } catch (err) {
      console.error('Error during offer/answer exchange:', err);
      throw err; // Propagate error to the caller
    }

    return remoteStreamPromise;
  }

  /**
   * Closes the RTCPeerConnection objects and resets the variables.
   */
  function closePeerConnection() {
    if (pc1) {
      pc1.close();
      pc1 = null;
      console.log('pc1 closed.');
    }
    if (pc2) {
      pc2.close();
      pc2 = null;
      console.log('pc2 closed.');
    }
  }

  /**
   * Sets up the ICE candidate exchange between two RTCPeerConnection objects.
   * @param {RTCPeerConnection} localPc
   * @param {RTCPeerConnection} remotePc
   */
  function exchangeIceCandidates(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      if (event.candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(event.candidate);
      }
    });
  }

  /**
   * Modifies an SDP string to add stereo support for the Opus codec.
   * @param {string} sdp The original SDP string.
   * @returns {string} The modified SDP string with stereo support for Opus.
   */
  const insertStereoSupportForOpus = (sdp) => {
    // Early exit if Opus codec (rtpmap:111) is not present.
    if (!sdp.includes('a=rtpmap:111 opus/48000')) {
      console.warn('Opus codec (111) not found in SDP. Stereo support not added.');
      return sdp;
    }

    // Find the format parameter line for Opus and add stereo=1 if it's not already there.
    const lines = sdp.split('\r\n');
    const newSdpLines = lines.map((line) => {
      if (line.startsWith('a=fmtp:111') && !line.includes('stereo=1')) {
        console.log('Adding stereo=1 to Opus fmtp line.');
        return `${line};stereo=1`;
      }
      return line;
    });

    return newSdpLines.join('\r\n');
  };

  /**
   * Modifies an SDP string to enable Discontinuous Transmission (DTX) for the Opus codec.
   * @param {string} sdp The original SDP string.
   * @returns {string} The modified SDP string with DTX enabled for Opus.
   */
  const insertDtxSupportForOpus = (sdp) => {
    // Early exit if Opus codec (rtpmap:111) is not present.
    if (!sdp.includes('a=rtpmap:111 opus/48000')) {
      console.warn('Opus codec (111) not found in SDP. DTX support not added.');
      return sdp;
    }

    // Find the format parameter line for Opus and add usedtx=1 if it's not already there.
    const lines = sdp.split('\r\n');
    const newSdpLines = lines.map((line) => {
      if (line.startsWith('a=fmtp:111') && !line.includes('usedtx=1')) {
        console.log('Adding usedtx=1 to Opus fmtp line.');
        return `${line};usedtx=1`;
      }
      return line;
    });

    return newSdpLines.join('\r\n');
  };

  const peerConnectionLabel = document.querySelector('label[for="peerconnection-checkbox"]');
  const dtxLabel = document.querySelector('label[for="dtx-checkbox"]');
  const muteLabel = document.querySelector('label[for="mute-checkbox"]');
  const htmlPlayLabel = document.querySelector('label[for="html-play-checkbox"]');
  const webaudioPlayLabel = document.querySelector('label[for="webaudio-play-checkbox"]');

  function updateActionButtonsTooltips() {
    if (gumButton.disabled) {
      gumButton.setAttribute('data-tooltip', "Active stream running via getUserMedia(). Click 'Stop Stream' to stop before requesting a new stream.");
    } else {
      gumButton.setAttribute('data-tooltip', 'Acquire a local audio MediaStream using the navigator.mediaDevices.getUserMedia() API and configured constraints.');
    }

    if (applyConstraintsButton.disabled) {
      applyConstraintsButton.setAttribute('data-tooltip', 'applyConstraints() requires an active audio MediaStreamTrack. Call getUserMedia() first.');
    } else {
      applyConstraintsButton.setAttribute('data-tooltip', 'Apply new dynamic constraints (echoCancellation, autoGainControl, noiseSuppression, voiceIsolation, channelCount, latency, sampleRate, sampleSize) to the live audio track using MediaStreamTrack.applyConstraints().');
    }
  }

  function updatePeerConnectionTooltip() {
    if (peerConnectionLabel) {
      peerConnectionLabel.setAttribute('data-tooltip', peerConnectionCheckbox.checked
        ? 'RTCPeerConnection loopback (pc1 -> pc2) is active. Displaying real-time getStats() reports.'
        : 'Send and receive the recorded local audio track via an RTCPeerConnection loopback (pc1 -> pc2) using Opus stereo.');
    }
  }

  function updateDtxTooltip() {
    if (dtxLabel) {
      dtxLabel.setAttribute('data-tooltip', dtxCheckbox.checked
        ? 'usedtx=1 is enabled in the Opus SDP fmtp line.'
        : 'Enable Voice Activity Detection (VAD), Discontinuous Transmission (DTX), and Comfort Noise Generation (CNG) for Opus in RTCPeerConnection by setting usedtx=1 in SDP.');
    }
  }

  function updateAutoRecordTooltip() {
    if (autoRecordLabel && autoRecordCheckbox) {
      autoRecordLabel.setAttribute('data-tooltip', autoRecordCheckbox.checked
        ? 'Auto-record is enabled. MediaRecorder will start capturing immediately when getUserMedia acquires the stream.'
        : 'Automatically start recording via MediaRecorder as soon as the audio track is acquired from getUserMedia().');
    }
  }

  function updateMuteTooltip() {
    if (muteLabel) {
      muteLabel.setAttribute('data-tooltip', muteCheckbox.checked
        ? 'Track is muted (MediaStreamTrack.enabled = false). Uncheck to unmute.'
        : 'Mute the audio track by setting MediaStreamTrack.enabled = false without stopping hardware capture.');
    }
  }

  function updateHtmlPlayTooltip() {
    if (htmlPlayLabel) {
      htmlPlayLabel.setAttribute('data-tooltip', htmlPlayCheckbox.checked
        ? 'Playing via HTML <audio> element (HTMLAudioElement.srcObject = localStream).'
        : 'Play the audio track directly using an HTML <audio> element with setSinkId() output routing.');
    }
  }

  function updateWebAudioPlayTooltip() {
    if (webaudioPlayLabel) {
      webaudioPlayLabel.setAttribute('data-tooltip', webaudioPlayCheckbox.checked
        ? 'Playing via Web Audio AudioContext destination.'
        : 'Route audio through Web Audio API (AudioContext & MediaStreamAudioSourceNode) applying latencyHint and sampleRate.');
    }
  }

  peerConnectionCheckbox.addEventListener('change', () => {
    updatePeerConnectionTooltip();
    if (peerConnectionCheckbox.checked) {
      console.log('PeerConnection enabled');
    } else {
      console.log('PeerConnection disabled');
    }
  });

  dtxCheckbox.addEventListener('change', () => {
    updateDtxTooltip();
    if (dtxCheckbox.checked) {
      console.log('VAD/DTX/CNG enabled');
    } else {
      console.log('VAD/DTX/CNG disabled');
    }
  });

  if (autoRecordCheckbox) {
    autoRecordCheckbox.addEventListener('change', () => {
      updateAutoRecordTooltip();
      if (autoRecordCheckbox.checked) {
        console.log('Auto-record enabled');
        logLifecycleEvent('Auto-Record', 'Auto-Record enabled (will capture audio at time zero)');
      } else {
        console.log('Auto-record disabled');
        logLifecycleEvent('Auto-Record', 'Auto-Record disabled');
      }
    });
  }

  // Set the initial tooltip state on page load.
  updateActionButtonsTooltips();
  updatePeerConnectionTooltip();
  updateDtxTooltip();
  updateAutoRecordTooltip();
  updateMuteTooltip();
  updateHtmlPlayTooltip();
  updateWebAudioPlayTooltip();

  const dynamicConstraintSelects = [
    echoCancellationSelect,
    autoGainControlSelect,
    noiseSuppressionSelect,
    voiceIsolationSelect,
    channelCountSelect,
    latencyConstraintSelect,
    sampleRateConstraintSelect,
    sampleSizeConstraintSelect,
  ].filter(Boolean);
  const constraintSelects = [
    ...dynamicConstraintSelects,
    audioDeviceSelect,
  ].filter(Boolean);
  const constraintsPreElements = document.querySelectorAll('.settings-container > pre');

  function updateInputSourceUI() {
    const isMic = micSourceRadio.checked;
    const isStreamActive = !!(localStream && localStream.active);
    
    // Toggle visibility of the file selection container
    fileSelectionContainer.style.display = isMic ? 'none' : 'flex';

    if (!isMic) {
      constraintSelects.forEach(select => {
        select.disabled = true;
        select.parentElement.classList.add('disabled-setting');
      });
      constraintsPreElements.forEach(pre => pre.classList.add('disabled-setting'));
      document.querySelector('.dynamic-constraints-group')?.classList.add('disabled-setting');
      applyConstraintsButton.disabled = true;
    } else {
      constraintsPreElements.forEach(pre => pre.classList.remove('disabled-setting'));
      document.querySelector('.dynamic-constraints-group')?.classList.remove('disabled-setting');
      if (isStreamActive) {
        dynamicConstraintSelects.forEach(select => {
          select.disabled = false;
          select.parentElement.classList.remove('disabled-setting');
        });
        audioDeviceSelect.disabled = true;
        audioDeviceSelect.parentElement.classList.add('disabled-setting');
        applyConstraintsButton.disabled = false;
      } else {
        constraintSelects.forEach(select => {
          select.disabled = false;
          select.parentElement.classList.remove('disabled-setting');
        });
        applyConstraintsButton.disabled = true;
      }
    }
  }

  micSourceRadio.addEventListener('change', updateInputSourceUI);
  fileSourceRadio.addEventListener('change', updateInputSourceUI);
  updateInputSourceUI();

  stopButton.disabled = true;
  recordButton.disabled = true;

  // This function runs on page load and applies any constraint settings passed in the URL.
  function applyUrlParameters() {
    // Get the query parameters from the current URL.
    const params = new URLSearchParams(window.location.search);
    // Helper function to set the value of a select element if a corresponding URL parameter exists.
    const setSelectValue = (paramName, element) => {
      // Check if the parameter is present in the URL.
      if (params.has(paramName)) {
        // If it exists, set the dropdown's value to the value from the URL.
        element.value = params.get(paramName);
      }
    };
    // Apply the URL parameters to each of the constraint dropdowns.
    setSelectValue('echoCancellation', echoCancellationSelect);
    setSelectValue('autoGainControl', autoGainControlSelect);
    setSelectValue('noiseSuppression', noiseSuppressionSelect);
    if (isVoiceIsolationSupported && voiceIsolationSelect) {
      setSelectValue('voiceIsolation', voiceIsolationSelect);
    }
    setSelectValue('channelCount', channelCountSelect);
    setSelectValue('latency', latencyConstraintSelect);
    setSelectValue('sampleRate', sampleRateConstraintSelect);
    setSelectValue('sampleSize', sampleSizeConstraintSelect);
    setSelectValue('deviceId', audioDeviceSelect);

    if (params.has('inputSource')) {
      const source = params.get('inputSource');
      if (source === 'file') {
        fileSourceRadio.checked = true;
        if (params.has('audioFile')) {
          audioFileSelect.value = params.get('audioFile');
        }
      } else {
        micSourceRadio.checked = true;
      }
      updateInputSourceUI();
    }

    if (params.has('peerConnection') && params.get('peerConnection') === 'true') {
      peerConnectionCheckbox.checked = true;
      // Manually trigger the change event to ensure the rest of the app state is updated.
      peerConnectionCheckbox.dispatchEvent(new Event('change'));
    }

    if (params.has('dtx') && params.get('dtx') === 'true') {
      dtxCheckbox.checked = true;
      // Manually trigger the change event to ensure the rest of the app state is updated.
      dtxCheckbox.dispatchEvent(new Event('change'));
    }

    if (params.has('autoRecord') && params.get('autoRecord') === 'true' && autoRecordCheckbox) {
      autoRecordCheckbox.checked = true;
      autoRecordCheckbox.dispatchEvent(new Event('change'));
    }

    console.log(`applyUrlParameters: echoCancellation from URL is "${params.get('echoCancellation')}"`);
    console.log(`applyUrlParameters: autoGainControl from URL is "${params.get('autoGainControl')}"`);
    console.log(`applyUrlParameters: noiseSuppression from URL is "${params.get('noiseSuppression')}"`);
    if (isVoiceIsolationSupported) {
      console.log(`applyUrlParameters: voiceIsolation from URL is "${params.get('voiceIsolation')}"`);
    }
    console.log(`applyUrlParameters: channelCount from URL is "${params.get('channelCount')}"`);
    console.log(`applyUrlParameters: latency from URL is "${params.get('latency')}"`);
    console.log(`applyUrlParameters: sampleRate from URL is "${params.get('sampleRate')}"`);
    console.log(`applyUrlParameters: sampleSize from URL is "${params.get('sampleSize')}"`);
    console.log(`applyUrlParameters: deviceId from URL is "${params.get('deviceId')}"`);
  }

  function setConstraintsDisabled(disabled) {
    constraintSelects.forEach(select => {
      select.disabled = disabled;
    });
    micSourceRadio.disabled = disabled;
    fileSourceRadio.disabled = disabled;
    audioFileSelect.disabled = disabled;
    localFileInput.disabled = disabled;

    if (!disabled) {
      updateInputSourceUI();
    }
  }

  function updateRecordButtonUI() {
    if (isRecording) {
      recordButton.classList.add('recording-active');
      recordButton.innerHTML = '<span class="record-dot"></span>Stop Rec';
      recordButton.setAttribute('data-tooltip', 'Stop recording and generate playable audio blob and waveform.');
    } else {
      recordButton.classList.remove('recording-active');
      recordButton.innerHTML = '<span class="record-dot"></span>Rec';
      recordButton.setAttribute('data-tooltip', 'Record the audio stream to an Opus WebM blob using the MediaRecorder API.');
    }
  }

  function findSupportedMimeType() {
    const mimeTypes = [
      'audio/webm; codecs=pcm',
      'audio/webm; codecs=opus',
      'audio/webm',
      'audio/ogg; codecs=opus',
      'audio/ogg',
    ];
    for (const mimeType of mimeTypes) {
      if (MediaRecorder.isTypeSupported(mimeType)) {
        console.log(`Using supported mimeType: ${mimeType}`);
        return mimeType;
      }
    }
    console.warn('No preferred mimeType supported. Using default.');
    return ''; // Let the browser decide
  }

  async function populateAudioInputDevices() {
    console.log('Populating audio input devices...');
    
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasPermissions = devices.every(device => device.label);
    if (!hasPermissions) {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia(
            { audio: true, video: false });
        tempStream.getTracks().forEach(track => track.stop());
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (err) {
        console.error('Error getting media permissions:', err);
        errorMessageElement.textContent = 
            `Error getting permissions: ${err.name} - ${err.message}`;
        errorMessageElement.style.display = 'block';
        return;
      }
    }

    const selectedDeviceId = audioDeviceSelect.value;
    console.log(`populateAudioInputDevices: selectedDeviceId before populating is "${selectedDeviceId}"`);
    audioDeviceSelect.innerHTML = '';

    // Add the static "undefined" option first.
    audioDeviceSelect.appendChild(new Option('undefined', 'undefined'));

    const audioInputDevices = devices.filter(device => device.kind === 'audioinput');

    audioInputDevices.forEach((device, index) => {
      const option = new Option(device.label || `Microphone ${index + 1}`,
          device.deviceId);
      audioDeviceSelect.appendChild(option);
    });

    if ([...audioDeviceSelect.options].some(option => 
        option.value === selectedDeviceId)) {
      audioDeviceSelect.value = selectedDeviceId;
    }
    console.log(`populateAudioInputDevices: selectedDeviceId after populating is "${audioDeviceSelect.value}"`);
  }

  async function populateAudioOutputDevices() {
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      audioOutputDeviceSelect.disabled = true;
      audioOutputDeviceSelect.title = 'Audio output device selection is not supported by this browser.';
      return;
    }
    console.log('Populating audio output devices...');
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selectedDeviceId = audioOutputDeviceSelect.value;
    console.log(`populateAudioOutputDevices: selectedDeviceId before populating is "${selectedDeviceId}"`);
    audioOutputDeviceSelect.innerHTML = '';

    // Add the static "undefined" option first.
    audioOutputDeviceSelect.appendChild(new Option('undefined', 'undefined'));

    const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');

    audioOutputDevices.forEach((device, index) => {
      const option = new Option(device.label || `Speaker ${index + 1}`,
          device.deviceId);
      audioOutputDeviceSelect.appendChild(option);
    });

    if ([...audioOutputDeviceSelect.options].some(option => 
        option.value === selectedDeviceId)) {
      audioOutputDeviceSelect.value = selectedDeviceId;
    }
    console.log(`populateAudioOutputDevices: selectedDeviceId after populating is "${audioOutputDeviceSelect.value}"`);
  }

  function visualizeAudio(stream) {
    if (audioContext) {
      audioContext.close();
    }
    audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    drawVisualizer();
  }

  function drawVisualizer() {
    if (!audioContext || audioContext.state === 'closed') {
      canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
      return;
    }
    requestAnimationFrame(drawVisualizer);
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);
    let sum = dataArray.reduce((a, b) => a + b, 0);
    let average = sum / bufferLength;
    canvasCtx.fillStyle = 'rgb(250, 250, 250)';
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    const barWidth = (average / 255) * visualizerCanvas.width;
    canvasCtx.fillStyle = '#00FF00';
    canvasCtx.fillRect(0, 0, barWidth, visualizerCanvas.height);

    // Draw the latest rmsAudioLevel and the rolling 10-second RMS if PeerConnection is enabled
    if (peerConnectionCheckbox.checked && rmsAudioLevels.length > 0) {
      // 1. Calculate the rolling 10-second RMS from the recent history
      const last10 = rmsAudioLevels.slice(-10);
      const sumOfSquares = last10.reduce((sum, val) => sum + val * val, 0);
      const trueRms10s = Math.sqrt(sumOfSquares / last10.length);

      canvasCtx.font = 'bold 12px "Lucida Console", "Courier New", monospace';
      canvasCtx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      canvasCtx.textAlign = 'left'; 
      canvasCtx.textBaseline = 'middle';

      // 2. Draw the 1-second snapshot (Increased Y-offset to 10 to avoid overlap)
      if (latestRmsAudioLevel !== null && latestRmsAudioLevel > 0) {
        const text1s = `1s:  ${Number(latestRmsAudioLevel).toFixed(5)}`;
        canvasCtx.fillText(text1s, 2, visualizerCanvas.height / 2 - 10);
      }

      // 3. Draw the rolling 10-second RMS (Increased Y-offset to 10)
      if (trueRms10s > 0) {
        const text10s = `10s: ${Number(trueRms10s).toFixed(5)}`;
        canvasCtx.fillText(text10s, 2, visualizerCanvas.height / 2 + 10);
      }
    }
  }

  function drawRecordedVisualizer() {
    recordedVisualizationFrameRequest = requestAnimationFrame(drawRecordedVisualizer);
    const bufferLength = recordedAnalyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    recordedAnalyser.getByteFrequencyData(dataArray);
    const canvas = recordedVisualizer;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const barWidth = (canvas.width / bufferLength) * 2.5;
    let barHeight;
    let x = 0;
    let maxFreqIndex = 0;
    for (let i = 0; i < bufferLength; i++) {
      barHeight = dataArray[i];
      if (barHeight > (dataArray[maxFreqIndex] || 0)) {
        maxFreqIndex = i;
      }
      ctx.fillStyle = 'rgb(' + (barHeight + 100) + ',50,50)';
      ctx.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
      x += barWidth + 1;
    }
  }

  function updateTrackProperties(audioTrack) {
    // Create a plain object of the current track properties we want to display.
    const currentProperties = {
      id: audioTrack.id, kind: audioTrack.kind, label: audioTrack.label,
      enabled: audioTrack.enabled, muted: audioTrack.muted, readyState: audioTrack.readyState,
    };
    console.log('MediaStreamTrack properties:', currentProperties);

    // Build the HTML string for the properties display.
    const header = 'properties:\n';
    let content = '{\n';
    // Get an array of [key, value] pairs to use .forEach() and track the index.
    const entries = Object.entries(currentProperties);
    // [key, value] comes from the array's contents, e.g., ["enabled", "true"]
    // 'index' is the position in the array, e.g., 2.
    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const valueStr = typeof value === 'string' ? `"${value}"` : value;
      const leadingSpaces = '  ';
      const textContent = `"${key}": ${valueStr}${isLast ? '' : ','}`;
      // Compare the current property value with the previous one.
      // If it has changed, wrap the line in a span with the 'highlight' class.
      if (previousTrackProperties && previousTrackProperties[key] !== value) {
        content += `${leadingSpaces}<span class="highlight">${textContent}</span>\n`;
      } else {
        content += `${leadingSpaces}${textContent}\n`;
      }
    });
    content += '}';

    // Update the element's content with the newly generated HTML.
    trackPropertiesElement.innerHTML = header + content;
    // Store the current properties to compare against in the next update.
    previousTrackProperties = currentProperties;

    // Set a timer to remove the highlight effect after a specified duration.
    setTimeout(() => {
      const highlightedElements = trackPropertiesElement.querySelectorAll('.highlight');
      highlightedElements.forEach(el => {
        el.classList.add('fade-out');
      });
    }, 5000);
  }

  /**
   * Updates the 'getConstraints():' UI box using track.getConstraints().
   *
   * Note on getConstraints() vs getSettings():
   * - track.getConstraints() returns the *requested* constraint dictionary applied to the track
   *   (via getUserMedia or applyConstraints). It can contain { ideal: ... }, { exact: ... },
   *   or plain values, and omits any properties that were left undefined.
   * - track.getSettings() returns the *actual resolved runtime state* running in the browser / hardware
   *   pipeline (always concrete primitives like booleans, numbers, and default values).
   *
   * @param {MediaStreamTrack} audioTrack - The active audio track to inspect.
   * @param {string[]} highlightedKeys - Array of constraint keys to highlight in yellow.
   */
  function updateTrackConstraints(audioTrack, highlightedKeys = []) {
    if (!micSourceRadio.checked || !audioTrack) {
      trackConstraintsElement.innerHTML = '';
      trackConstraintsElement.style.display = 'none';
      return;
    }
    const constraints = audioTrack.getConstraints ? audioTrack.getConstraints() : {};
    const displayConstraints = structuredClone(constraints);
    if (displayConstraints.deviceId) {
      if (typeof displayConstraints.deviceId === 'string' && displayConstraints.deviceId !== 'default') {
        displayConstraints.deviceId = `${displayConstraints.deviceId.substring(0, 8)}..${displayConstraints.deviceId.substring(displayConstraints.deviceId.length - 8)}`;
      } else if (displayConstraints.deviceId.exact && typeof displayConstraints.deviceId.exact === 'string' && displayConstraints.deviceId.exact !== 'default') {
        const id = displayConstraints.deviceId.exact;
        displayConstraints.deviceId.exact = `${id.substring(0, 8)}..${id.substring(id.length - 8)}`;
      }
    }

    const header = 'getConstraints():\n';
    const entries = Object.entries(displayConstraints);
    if (entries.length === 0) {
      trackConstraintsElement.innerHTML = header + '{}';
      trackConstraintsElement.style.display = 'block';
      return;
    }

    let content = '{\n';
    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const jsonVal = JSON.stringify(value, null, 2);
      const indentedVal = jsonVal.includes('\n')
        ? jsonVal.split('\n').map((line, lIdx) => lIdx === 0 ? line : '  ' + line).join('\n')
        : jsonVal;
      const leadingSpaces = '  ';
      const textContent = `"${key}": ${indentedVal}${isLast ? '' : ','}`;
      if (highlightedKeys.includes(key)) {
        content += `${leadingSpaces}<span class="highlight">${textContent}</span>\n`;
      } else {
        content += `${leadingSpaces}${textContent}\n`;
      }
    });
    content += '}';

    trackConstraintsElement.innerHTML = header + content;
    trackConstraintsElement.style.display = 'block';

    if (highlightedKeys.length > 0) {
      setTimeout(() => {
        const elements = trackConstraintsElement.querySelectorAll('.highlight');
        elements.forEach(el => el.classList.add('fade-out'));
      }, 5000);
    }
  }

  /**
   * Compares requested audio constraints against track settings and computes
   * a status map indicating whether each constraint was applied or not applied.
   * @param {Object} requestedConstraints
   * @param {Object} trackSettings
   * @returns {Record<string, 'applied' | 'not-applied'>}
   */
  function computeConstraintStatusMap(requestedConstraints, trackSettings = {}) {
    const statusMap = {};
    const requestedKeys = Object.keys(requestedConstraints);

    requestedKeys.forEach(key => {
      const constraintVal = requestedConstraints[key];
      let targetVal = constraintVal;
      if (constraintVal && typeof constraintVal === 'object') {
        if (constraintVal.exact !== undefined) targetVal = constraintVal.exact;
        else if (constraintVal.ideal !== undefined) targetVal = constraintVal.ideal;
      }

      const actualVal = trackSettings[key];
      // Compare targetVal with actualVal in settings (with float tolerance for latency/sampleRate)
      let isMatch = false;
      if (actualVal !== undefined) {
        if (typeof targetVal === 'number' && typeof actualVal === 'number') {
          isMatch = Math.abs(targetVal - actualVal) < 0.0001;
        } else {
          isMatch = actualVal === targetVal;
        }
      }
      if (isMatch) {
        statusMap[key] = 'applied';
      } else {
        statusMap[key] = 'not-applied';
      }
    });

    return statusMap;
  }

  /**
   * Updates the 'getSettings():' UI box using track.getSettings().
   *
   * @param {MediaStreamTrack} audioTrack - The active audio track to inspect.
   * @param {Record<string, 'applied' | 'not-applied'>} statusMap - Mapping of setting keys to their application status.
   */
  function updateTrackSettings(audioTrack, statusMap = {}) {
    if (!audioTrack) {
      trackSettingsElement.innerHTML = '';
      return;
    }
    const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
    const displaySettings = structuredClone(settings);
    if (displaySettings.groupId && typeof displaySettings.groupId === 'string') {
      displaySettings.groupId = `${displaySettings.groupId.substring(0, 8)}..${displaySettings.groupId.substring(displaySettings.groupId.length - 8)}`;
    }
    if (displaySettings.deviceId && typeof displaySettings.deviceId === 'string' && displaySettings.deviceId !== 'default') {
      displaySettings.deviceId = `${displaySettings.deviceId.substring(0, 8)}..${displaySettings.deviceId.substring(displaySettings.deviceId.length - 8)}`;
    }

    const header = 'getSettings():\n';
    const entries = Object.entries(displaySettings);
    if (entries.length === 0) {
      trackSettingsElement.innerHTML = header + '{}';
      return;
    }

    let content = '{\n';
    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const jsonVal = JSON.stringify(value, null, 2);
      const indentedVal = jsonVal.includes('\n')
        ? jsonVal.split('\n').map((line, lIdx) => lIdx === 0 ? line : '  ' + line).join('\n')
        : jsonVal;
      const leadingSpaces = '  ';
      const textContent = `"${key}": ${indentedVal}${isLast ? '' : ','}`;
      const status = statusMap[key];
      if (status === 'applied') {
        content += `${leadingSpaces}<span class="highlight-green">${textContent}</span>\n`;
      } else if (status === 'not-applied') {
        content += `${leadingSpaces}<span class="highlight-red">${textContent}</span>\n`;
      } else {
        content += `${leadingSpaces}${textContent}\n`;
      }
    });
    content += '}';

    trackSettingsElement.innerHTML = header + content;

    if (Object.keys(statusMap).length > 0) {
      setTimeout(() => {
        const elements = trackSettingsElement.querySelectorAll('.highlight-green, .highlight-red');
        elements.forEach(el => el.classList.add('fade-out'));
      }, 5000);
    }
  }

  function updateTrackStats(audioTrack) {
    if (!audioTrack || audioTrack.readyState === 'ended') {
      trackStatsElement.textContent = '';
      previousStats = null;
      return;
    }
    if (audioTrack.stats) {
      const currentStats = audioTrack.stats;
      // Manually create a new object and copy properties to have full control
      // over the presented output.
      const extendedStats = {};

      if (previousStats) {
        const deltaStats = {
          deliveredFrames: currentStats.deliveredFrames - previousStats.deliveredFrames,
          totalFrames: currentStats.totalFrames - previousStats.totalFrames,
          droppedFrames: (currentStats.totalFrames - currentStats.deliveredFrames) - previousStats.droppedFrames,
        };
        extendedStats.FPS = deltaStats;
      }

      extendedStats.deliveredFrames = currentStats.deliveredFrames;
      extendedStats.totalFrames = currentStats.totalFrames;
      extendedStats.droppedFrames = currentStats.totalFrames - currentStats.deliveredFrames;
      extendedStats.averageLatency = currentStats.averageLatency.toFixed(1);

      trackStatsElement.textContent = 'stats:\n' + JSON.stringify(extendedStats, null, 2);

      // Update previousStats for the next call, storing only the necessary fields.
      previousStats = {
        deliveredFrames: currentStats.deliveredFrames,
        totalFrames: currentStats.totalFrames,
        droppedFrames: extendedStats.droppedFrames,
      };
    } else {
      trackStatsElement.textContent = 'stats:\nNot supported';
      previousStats = null;
    }
  }

  /**
   * Fetches and displays RTCOutboundRtpStreamStats from pc1, and RTCInboundRtpStreamStats
   * and RTCAudioPlayoutStats from pc2.
   * The displayed stats are based on the specifications:
   * - https://w3c.github.io/webrtc-stats/#outboundrtpstats-dict
   * - https://w3c.github.io/webrtc-stats/#dom-rtcinboundrtpstreamstats
   * - https://w3c.github.io/webrtc-stats/#dom-rtcaudioplayoutstats
   * If no active PeerConnection is found, it hides the stats boxes.
   */
  async function updateRtpStats() {
    if (!pc1 || !peerConnectionCheckbox.checked) {
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.style.display = 'none';
      outboundRtpStatsElement.style.display = 'none';
      inboundRtpStatsElement.style.display = 'none';
      audioPlayoutStatsElement.style.display = 'none';
      return;
    }

    try {
      const report = await pc1.getStats();
      let outboundStatsFound = false;
      for (const stats of report.values()) {
        if (stats.type === 'outbound-rtp') {
          outboundStatsFound = true;
          const displayStats = {};

          // Calculate and add current rates (bitrate, packets per second).
          if (previousOutboundRtpStats) {
            const timeDiffSeconds = (stats.timestamp - previousOutboundRtpStats.timestamp) / 1000.0;
            if (timeDiffSeconds > 0) {
              const bytesSent = stats.bytesSent - previousOutboundRtpStats.bytesSent;
              const bitsSent = bytesSent * 8;
              const packetsSent = stats.packetsSent - previousOutboundRtpStats.packetsSent;
    
              displayStats.rate = {
                bps: Math.round(bitsSent / timeDiffSeconds),
                pps: parseFloat((packetsSent / timeDiffSeconds).toFixed(1)),
                bpp: packetsSent > 0 ? parseFloat((bytesSent / packetsSent).toFixed(1)) : 0,
              };
            }
          }

          // Update previousOutboundRtpStats for the next interval's calculation.
          previousOutboundRtpStats = {
            bytesSent: stats.bytesSent,
            packetsSent: stats.packetsSent,
            timestamp: stats.timestamp,
          };

          displayStats.packetsSent = stats.packetsSent;
          displayStats.bytesSent = stats.bytesSent;
          if (stats.powerEfficientEncoder !== undefined) {
            displayStats.powerEfficientEncoder = stats.powerEfficientEncoder;
          }
          if (stats.encoderImplementation) {
            displayStats.encoderImplementation = stats.encoderImplementation;
          }

          // Calculate and add average packet send delay if data is available.
          if (stats.totalPacketSendDelay && stats.packetsSent > 0) {
            const averageDelayMs = (stats.totalPacketSendDelay / stats.packetsSent) * 1000;
            displayStats.averagePacketSendDelayMs = parseFloat(averageDelayMs.toFixed(1));
          }

          // Add additional health and quality metrics.
          // Retransmission stats are a direct indicator of packet loss.
          if (stats.retransmittedPacketsSent !== undefined) {
            displayStats.retransmittedPacketsSent = stats.retransmittedPacketsSent;
          }
          if (stats.retransmittedBytesSent !== undefined) {
            displayStats.retransmittedBytesSent = stats.retransmittedBytesSent;
          }
          // The bitrate the encoder is currently aiming for.
          if (stats.targetBitrate !== undefined) {
            displayStats.targetBitrate = stats.targetBitrate;
          }
          // A cumulative count of samples sent, confirming continuous audio processing.
          if (stats.totalSamplesSent !== undefined) {
            displayStats.totalSamplesSent = stats.totalSamplesSent;
          }
          // The id of the MediaStreamTrack, for debugging.
          if (stats.trackIdentifier) {
            displayStats.trackIdentifier = stats.trackIdentifier;
          }

          if (stats.codecId) {
            const codec = report.get(stats.codecId);
            if (codec) {
              displayStats.codec = codec.mimeType.split('/')[1];
              displayStats.channels = codec.channels;
            }
          }
          outboundRtpStatsElement.textContent = 'outbound-rtp (pc1):\n' + JSON.stringify(displayStats, null, 2);
          inboundRtpStatsElement.textContent = 'inbound-rtp (pc2):\n';
          audioPlayoutStatsElement.textContent = 'audio-playout (pc2):\n';
        }
      }
      // Show or hide the element based on whether stats were found in this report.
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.style.display = outboundStatsFound ? 'block' : 'none';
      outboundRtpStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
      inboundRtpStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
      audioPlayoutStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
    } catch (err) {
      console.error('Error getting RTP stats:', err);
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.style.display = 'none';
      outboundRtpStatsElement.style.display = 'none';
      inboundRtpStatsElement.style.display = 'none';
      audioPlayoutStatsElement.style.display = 'none';
    }

    if (pc2) {
      try {
        const report = await pc2.getStats();
        let playoutStatsFound = false;
        let inboundRtpStatsFound = false;
        for (const stats of report.values()) {
          if (stats.type === 'inbound-rtp') {
            inboundRtpStatsFound = true;
            const displayStats = {};
            if (previousInboundRtpStats) {
              const timeDiffSeconds = (stats.timestamp - previousInboundRtpStats.timestamp) / 1000.0;
              const deltaPacketsDiscarded = stats.packetsDiscarded - previousInboundRtpStats.packetsDiscarded;
              const deltaBytesReceived = stats.bytesReceived - previousInboundRtpStats.bytesReceived;
              const deltaConcealedSamples = stats.concealedSamples - previousInboundRtpStats.concealedSamples;
              const deltaPacketsReceived = stats.packetsReceived - previousInboundRtpStats.packetsReceived;
              const bps = (timeDiffSeconds > 0) ? Math.round((deltaBytesReceived * 8) / timeDiffSeconds) : 0;
              const pps = (timeDiffSeconds > 0) ? parseFloat((deltaPacketsReceived / timeDiffSeconds).toFixed(1)) : 0;
              const bpp = (deltaPacketsReceived > 0) ? parseFloat((deltaBytesReceived / deltaPacketsReceived).toFixed(1)) : 0;

              const rate = {
                bps: bps,
                pps: pps,
                bpp: bpp,
                packetsDiscarded: deltaPacketsDiscarded,
                concealedSamples: deltaConcealedSamples,
              };

              // Calculate and add interval-specific RMS audio level.
              if (previousInboundRtpStats.totalAudioEnergy !== undefined && previousInboundRtpStats.totalSamplesDuration !== undefined) {
                const deltaTotalAudioEnergy = stats.totalAudioEnergy - previousInboundRtpStats.totalAudioEnergy;
                const deltaTotalSamplesDuration = stats.totalSamplesDuration - previousInboundRtpStats.totalSamplesDuration;
                if (deltaTotalSamplesDuration > 0) {
                  const rms = Math.sqrt(deltaTotalAudioEnergy / deltaTotalSamplesDuration);
                  rate.rmsAudioLevel = parseFloat(rms.toFixed(5));
                  latestRmsAudioLevel = rate.rmsAudioLevel;
                  rmsAudioLevels.push(rate.rmsAudioLevel);
                  if (rms > 0) {
                    // dBov stands for decibels relative to full scale.
                    const rmsDBov = 20 * Math.log10(rms);
                    rate.rmsDBov = parseFloat(rmsDBov.toFixed(1));
                  }
                }
              }

              // Calculate and add interval-specific processing and jitter delays.
              if (previousInboundRtpStats.totalProcessingDelay !== undefined) {
                const deltaTotalProcessingDelay = stats.totalProcessingDelay - previousInboundRtpStats.totalProcessingDelay;
                const previousTotalSamplesDecoded = previousInboundRtpStats.totalSamplesReceived - previousInboundRtpStats.concealedSamples;
                const currentTotalSamplesDecoded = stats.totalSamplesReceived - stats.concealedSamples;
                const deltaTotalSamplesDecoded = currentTotalSamplesDecoded - previousTotalSamplesDecoded;
                if (deltaTotalSamplesDecoded > 0) {
                  const processingDelayMs = (deltaTotalProcessingDelay / deltaTotalSamplesDecoded) * 1000;
                  rate.processingDelayMs = parseFloat(processingDelayMs.toFixed(1));
                }
              }

              if (previousInboundRtpStats.jitterBufferTargetDelay !== undefined) {
                const deltaJitterBufferTargetDelay = stats.jitterBufferTargetDelay - previousInboundRtpStats.jitterBufferTargetDelay;
                const deltaJitterBufferEmittedCount = stats.jitterBufferEmittedCount - previousInboundRtpStats.jitterBufferEmittedCount;
                if (deltaJitterBufferEmittedCount > 0) {
                  const jitterBufferTargetDelayMs = (deltaJitterBufferTargetDelay / deltaJitterBufferEmittedCount) * 1000;
                  rate.jitterBufferTargetDelayMs = parseFloat(jitterBufferTargetDelayMs.toFixed(1));
                }
              }
              displayStats.rate = rate;
            }

            if (stats.ssrc !== undefined) {
              displayStats.ssrc = stats.ssrc;
            }
            if (stats.packetsDiscarded !== undefined) {
              displayStats.packetsDiscarded = stats.packetsDiscarded;
            }
            if (stats.concealedSamples !== undefined) {
              displayStats.concealedSamples = stats.concealedSamples;
            }
            if (stats.playoutId) {
              displayStats.playoutId = stats.playoutId;
            }
            if (stats.totalAudioEnergy !== undefined) {
              displayStats.totalAudioEnergy = parseFloat(stats.totalAudioEnergy.toFixed(1));
            }

            // audioLevel is only reported when the track is actively being played out.
            // The value is linear from 0.0 (silence) to 1.0 (0 dBov).
            // A value of 0.5 represents approximately a 6 dBSPL change.
            // The audioLevel is averaged over some small interval.
            if (stats.audioLevel !== undefined) {
              displayStats.audioLevel = parseFloat(stats.audioLevel.toFixed(2));
            }

            if (stats.totalProcessingDelay !== undefined && stats.totalSamplesReceived !== undefined && stats.concealedSamples !== undefined) {
              const totalSamplesDecoded = stats.totalSamplesReceived - stats.concealedSamples;
              if (totalSamplesDecoded > 0) {
                const averageProcessingDelayMs = (stats.totalProcessingDelay / totalSamplesDecoded) * 1000;
                displayStats.averageProcessingDelayMs = parseFloat(averageProcessingDelayMs.toFixed(1));
              }
            }

            if (stats.jitterBufferTargetDelay !== undefined && stats.jitterBufferEmittedCount !== undefined) {
              if (stats.jitterBufferEmittedCount > 0) {
                const averageJitterBufferTargetDelayMs = (stats.jitterBufferTargetDelay / stats.jitterBufferEmittedCount) * 1000;
                displayStats.averageJitterBufferTargetDelayMs = parseFloat(averageJitterBufferTargetDelayMs.toFixed(1));
              }
            }

            previousInboundRtpStats = {
              packetsDiscarded: stats.packetsDiscarded,
              bytesReceived: stats.bytesReceived,
              timestamp: stats.timestamp,
              totalProcessingDelay: stats.totalProcessingDelay,
              totalSamplesReceived: stats.totalSamplesReceived,
              concealedSamples: stats.concealedSamples,
              jitterBufferTargetDelay: stats.jitterBufferTargetDelay,
              jitterBufferEmittedCount: stats.jitterBufferEmittedCount,
              totalAudioEnergy: stats.totalAudioEnergy,
              totalSamplesDuration: stats.totalSamplesDuration,
              packetsReceived: stats.packetsReceived,
            };
            let statsString = JSON.stringify(displayStats, null, 2);
            if (displayStats.rate && displayStats.rate.rmsAudioLevel !== undefined) {
              statsString = statsString.replace(
                  /"rmsAudioLevel": ([\d.]+)/,
                  '"rmsAudioLevel": <b>$1</b>'
              );
            }
            inboundRtpStatsElement.innerHTML = 'inbound-rtp (pc2):\n' + statsString;
          }
          if (stats.type === 'media-playout') {
            playoutStatsFound = true;
            const displayStats = {};

            // Calculate and add interval-specific rates.
            if (previousPlayoutStats) {
              const deltaSynthesizedSamplesDuration = stats.synthesizedSamplesDuration - previousPlayoutStats.synthesizedSamplesDuration;
              const deltaTotalSamplesDuration = stats.totalSamplesDuration - previousPlayoutStats.totalSamplesDuration;
              const deltaTotalPlayoutDelay = stats.totalPlayoutDelay - previousPlayoutStats.totalPlayoutDelay;
              const deltaTotalSamplesCount = stats.totalSamplesCount - previousPlayoutStats.totalSamplesCount;
              const deltaSynthesizedSamplesEvents = stats.synthesizedSamplesEvents - previousPlayoutStats.synthesizedSamplesEvents;

              const interval = {};
              interval.synthesizedSamplesEvents = deltaSynthesizedSamplesEvents;
              interval.synthesizedSamplesDuration = parseFloat(deltaSynthesizedSamplesDuration.toFixed(3));
              const synthesizedSamplesPercentage = (deltaTotalSamplesDuration > 0) ? (deltaSynthesizedSamplesDuration / deltaTotalSamplesDuration) * 100 : 0;
              interval.synthesizedSamplesPercentage = parseFloat(synthesizedSamplesPercentage.toFixed(1));
              const averagePlayoutDelayMs = (deltaTotalSamplesCount > 0) ? (deltaTotalPlayoutDelay / deltaTotalSamplesCount) * 1000 : 0;
              interval.averagePlayoutDelayMs = parseFloat(averagePlayoutDelayMs.toFixed(1));
              displayStats.interval = interval;

              if (stats.synthesizedSamplesDuration > previousPlayoutStats.synthesizedSamplesDuration) {
                glitchy_intervals++;
              }
            }

            const glitch_metrics = {};
            total_intervals++;
            glitch_metrics.glitchy_intervals = glitchy_intervals;
            glitch_metrics.total_intervals = total_intervals;
            let ratio = 0;
            if (total_intervals > 0) {
              ratio = glitchy_intervals / total_intervals;
            }
            glitch_metrics.glitchy_intervals_ratio = ratio === 0 ? 0 : parseFloat(ratio.toFixed(5));
            displayStats.glitch_metrics = glitch_metrics;

            if (stats.kind !== undefined) {
              displayStats.kind = stats.kind;
            }
            displayStats.synthesizedSamplesEvents = stats.synthesizedSamplesEvents;
            displayStats.synthesizedSamplesDuration = parseFloat(stats.synthesizedSamplesDuration.toFixed(3));
            displayStats.totalSamplesDuration = parseFloat(stats.totalSamplesDuration.toFixed(1));
            displayStats.totalPlayoutDelay = parseFloat(stats.totalPlayoutDelay.toFixed(3));
            displayStats.totalSamplesCount = stats.totalSamplesCount;

            if (stats.totalSamplesCount > 0) {
              const averagePlayoutDelayMs = (stats.totalPlayoutDelay / stats.totalSamplesCount) * 1000;
              displayStats.averagePlayoutDelayMs = parseFloat(averagePlayoutDelayMs.toFixed(1));
            }
            if (stats.totalSamplesDuration > 0) {
              const averageSynthesizedPercentage = (stats.synthesizedSamplesDuration / stats.totalSamplesDuration) * 100;
              displayStats.averageSynthesizedPercentage = parseFloat(averageSynthesizedPercentage.toFixed(1));
            }

            // Update previousPlayoutStats for the next interval.
            previousPlayoutStats = {
              synthesizedSamplesEvents: stats.synthesizedSamplesEvents,
              synthesizedSamplesDuration: stats.synthesizedSamplesDuration,
              totalSamplesDuration: stats.totalSamplesDuration,
              totalPlayoutDelay: stats.totalPlayoutDelay,
              totalSamplesCount: stats.totalSamplesCount,
            };

            audioPlayoutStatsElement.textContent = 'audio-playout (pc2):\n' + JSON.stringify(displayStats, null, 2);
          }
        }
        if (!playoutStatsFound) {
          audioPlayoutStatsElement.textContent = 'audio-playout (pc2):\n';
        }
        if (!inboundRtpStatsFound) {
          inboundRtpStatsElement.textContent = 'inbound-rtp (pc2):\n';
        }
      } catch (err) {
        console.error('Error getting RTP stats from pc2:', err);
      }
    }
  }

  function buildAudioConstraints() {
    const audioConstraints = {};
    const echoCancellation = echoCancellationSelect.value;
    console.log('Selected echoCancellation value:', echoCancellation);
    if (echoCancellation !== 'undefined') {
      if (echoCancellation.startsWith('ideal:')) {
        audioConstraints.echoCancellation = { ideal: echoCancellation.substring(6) };
      } else if (echoCancellation === 'true') {
        audioConstraints.echoCancellation = true;
      } else if (echoCancellation === 'false') {
        audioConstraints.echoCancellation = false;
      } else {
        audioConstraints.echoCancellation = { exact: echoCancellation };
      }
    }
    const autoGainControl = autoGainControlSelect.value;
    if (autoGainControl !== 'undefined') {
      if (autoGainControl.startsWith('exact:')) {
        audioConstraints.autoGainControl = { exact: autoGainControl.substring(6) === 'true' };
      } else if (autoGainControl.startsWith('ideal:')) {
        audioConstraints.autoGainControl = { ideal: autoGainControl.substring(6) === 'true' };
      } else {
        audioConstraints.autoGainControl = autoGainControl === 'true';
      }
    }
    const noiseSuppression = noiseSuppressionSelect.value;
    if (noiseSuppression !== 'undefined') {
      if (noiseSuppression.startsWith('exact:')) {
        audioConstraints.noiseSuppression = { exact: noiseSuppression.substring(6) === 'true' };
      } else if (noiseSuppression.startsWith('ideal:')) {
        audioConstraints.noiseSuppression = { ideal: noiseSuppression.substring(6) === 'true' };
      } else {
        audioConstraints.noiseSuppression = noiseSuppression === 'true';
      }
    }
    if (isVoiceIsolationSupported && voiceIsolationSelect) {
      const voiceIsolation = voiceIsolationSelect.value;
      if (voiceIsolation !== 'undefined') {
        if (voiceIsolation.startsWith('exact:')) {
          audioConstraints.voiceIsolation = { exact: voiceIsolation.substring(6) === 'true' };
        } else if (voiceIsolation.startsWith('ideal:')) {
          audioConstraints.voiceIsolation = { ideal: voiceIsolation.substring(6) === 'true' };
        } else {
          audioConstraints.voiceIsolation = voiceIsolation === 'true';
        }
      }
    }
    const channelCount = channelCountSelect.value;
    if (channelCount !== 'undefined') {
      if (channelCount.startsWith('exact:')) {
        audioConstraints.channelCount = { exact: parseInt(channelCount.substring(6), 10) };
      } else if (channelCount.startsWith('ideal:')) {
        audioConstraints.channelCount = { ideal: parseInt(channelCount.substring(6), 10) };
      } else {
        audioConstraints.channelCount = parseInt(channelCount, 10);
      }
    }
    const latency = latencyConstraintSelect ? latencyConstraintSelect.value : 'undefined';
    if (latency !== 'undefined') {
      if (latency.startsWith('exact:')) {
        audioConstraints.latency = { exact: parseFloat(latency.substring(6)) };
      } else if (latency.startsWith('ideal:')) {
        audioConstraints.latency = { ideal: parseFloat(latency.substring(6)) };
      } else {
        audioConstraints.latency = parseFloat(latency);
      }
    }
    const sampleRate = sampleRateConstraintSelect ? sampleRateConstraintSelect.value : 'undefined';
    if (sampleRate !== 'undefined') {
      if (sampleRate.startsWith('exact:')) {
        audioConstraints.sampleRate = { exact: parseInt(sampleRate.substring(6), 10) };
      } else if (sampleRate.startsWith('ideal:')) {
        audioConstraints.sampleRate = { ideal: parseInt(sampleRate.substring(6), 10) };
      } else {
        audioConstraints.sampleRate = parseInt(sampleRate, 10);
      }
    }
    const sampleSize = sampleSizeConstraintSelect ? sampleSizeConstraintSelect.value : 'undefined';
    if (sampleSize !== 'undefined') {
      if (sampleSize.startsWith('exact:')) {
        audioConstraints.sampleSize = { exact: parseInt(sampleSize.substring(6), 10) };
      } else if (sampleSize.startsWith('ideal:')) {
        audioConstraints.sampleSize = { ideal: parseInt(sampleSize.substring(6), 10) };
      } else {
        audioConstraints.sampleSize = parseInt(sampleSize, 10);
      }
    }
    return audioConstraints;
  }

  gumButton.addEventListener('click', async () => {
    gumButton.disabled = true;
    updateActionButtonsTooltips();
    copyBookmarkButton.disabled = true;
    peerConnectionCheckbox.disabled = true;
    dtxCheckbox.disabled = true;
    if (autoRecordCheckbox) {
      autoRecordCheckbox.disabled = true;
    }
    setConstraintsDisabled(true);
    previousStats = null;
    previousTrackProperties = null;
    previousOutboundRtpStats = null;
    previousInboundRtpStats = null;
    previousPlayoutStats = null;
    total_intervals = 0;
    glitchy_intervals = 0;
    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';
    bookmarkUrlContainer.innerHTML = ''; // Clear the bookmark URL
    // Reset to default error colors from CSS
    errorMessageElement.style.color = '';
    errorMessageElement.style.backgroundColor = '';
    errorMessageElement.style.borderColor = '';
    const audioConstraints = buildAudioConstraints();
    const deviceId = audioDeviceSelect.value;
    if (deviceId !== 'undefined') {
      audioConstraints.deviceId = { exact: deviceId };
    }
    const constraints = {
      audio: Object.keys(audioConstraints).length === 0 ? true : audioConstraints,
      video: false
    };
    console.log('--- getUserMedia() START ---');
    console.log('Supplied constraints to getUserMedia():', JSON.stringify(constraints, null, 2));

    try {
      let stream;
      if (micSourceRadio.checked) {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        console.log('navigator.mediaDevices.getUserMedia() succeeded.');
      } else {
        if (currentFileSourceType === 'predefined') {
          const selectedFile = audioFileSelect.value;
          fileSourceAudio.src = `audio/${selectedFile}`;
        } else {
           if (!localFileBlobUrl) {
              // Fallback checks
              const file = localFileInput.files[0];
              if (file) {
                 localFileBlobUrl = URL.createObjectURL(file);
                 localFileName = file.name;
              }
           }
           
           if (localFileBlobUrl) {
             fileSourceAudio.src = localFileBlobUrl;
           } else {
             // Fallback to predefined if no local file selected
             console.warn('No local file selected, using predefined.');
             const selectedFile = audioFileSelect.value;
             fileSourceAudio.src = `audio/${selectedFile}`;
           }
        }

        // Ensure the audio is loaded before capturing the stream
        await new Promise((resolve) => {
          fileSourceAudio.oncanplaythrough = resolve;
          fileSourceAudio.load();
        });
        fileSourceAudio.muted = true;
        await fileSourceAudio.play();
        // captureStream() might take an optional frameRate, but for audio it's usually just captureStream()
        stream = fileSourceAudio.captureStream ? fileSourceAudio.captureStream() : fileSourceAudio.mozCaptureStream();
        console.log('audioElement.captureStream() successful');
      }
      
      localStream = stream;

      // Start recording immediately at time zero if Auto-Record is enabled
      if (autoRecordCheckbox && autoRecordCheckbox.checked) {
        startRecording(true);
      }

      streamForPlaybackAndVisualizer = localStream;
      if (peerConnectionCheckbox.checked) {
        try {
          const remoteStream = await setupPeerConnection(localStream);
          console.log('PeerConnection loopback established successfully.');
          streamForPlaybackAndVisualizer = remoteStream;
        } catch (err) {
          console.error('PeerConnection setup failed:', err);
          errorMessageElement.textContent = `PC Error: ${err.name} - ${err.message}`;
          errorMessageElement.style.display = 'block';
          logLifecycleEvent('PeerConnection Error', `${err.name}: ${err.message}`, 'error');
          // Don't proceed with a broken stream setup
          return;
        }
      }

      const [audioTrack] = stream.getAudioTracks();
      console.log('Created audioTrack:', audioTrack.label, `(id: ${audioTrack.id}, readyState: ${audioTrack.readyState})`);
      console.log('audioTrack.getConstraints() returns:', audioTrack.getConstraints ? audioTrack.getConstraints() : 'N/A');
      console.log('audioTrack.getSettings() returns:', audioTrack.getSettings());
      console.log('--- getUserMedia() END ---');
      logLifecycleEvent(micSourceRadio.checked ? 'getUserMedia' : 'captureStream', `Acquired audio track "${audioTrack.label || 'Audio track'}" (id: ${audioTrack.id.substring(0, 8)}..)`, 'success');
      const requestedKeys = micSourceRadio.checked ? Object.keys(audioConstraints) : [];
      const statusMap = micSourceRadio.checked
        ? computeConstraintStatusMap(audioConstraints, audioTrack.getSettings ? audioTrack.getSettings() : {})
        : {};
      updateTrackConstraints(audioTrack, requestedKeys);
      updateTrackSettings(audioTrack, statusMap);
      updateTrackProperties(audioTrack);
      rmsAudioLevels = [];
      latestRmsAudioLevel = null;
      statsInterval = setInterval(() => {
        updateTrackStats(audioTrack);
        updateRtpStats();
      }, 1000);
      audioTrack.onmute = (event) => {
        console.log('Audio track muted:', event);
        logLifecycleEvent('track.onmute', `Warning: Audio track muted - ${event.type}`, 'warning');
        errorMessageElement.textContent = `Warning: Audio track muted - ${event.type}`;
        errorMessageElement.style.display = 'block';
        errorMessageElement.style.color = '#2F652F';
        errorMessageElement.style.backgroundColor = '#DFF2BF';
        errorMessageElement.style.borderColor = '#4F8A10';
        updateTrackProperties(audioTrack);
      };
      audioTrack.onunmute = (event) => {
        console.log('Audio track unmuted:', event);
        logLifecycleEvent('track.onunmute', 'Audio track unmuted - capture resumed', 'success');
        errorMessageElement.textContent = '';
        errorMessageElement.style.display = 'none';
        // Reset to default error colors from CSS
        errorMessageElement.style.color = '';
        errorMessageElement.style.backgroundColor = '';
        errorMessageElement.style.borderColor = '';
        updateTrackProperties(audioTrack);
      };
      audioTrack.onended = (event) => {
        console.error('Audio track ended:', event);
        logLifecycleEvent('track.onended', `Warning: Audio track ended - ${event.type}`, 'warning');
        
        updateTrackProperties(audioTrack);
        if (rmsAudioLevels.length > 0) {
          // Trim leading zeros.
          const firstNonZeroIndex = rmsAudioLevels.findIndex((level) => level > 0);
          const trimmedLevels = firstNonZeroIndex === -1 ? [] : rmsAudioLevels.slice(firstNonZeroIndex);
          
          if (trimmedLevels.length > 0) {
            console.log('rmsAudioLevels (trimmed) = ' + JSON.stringify(trimmedLevels));
            
            // 1. Calculate True RMS for the complete duration
            const totalSumOfSquares = trimmedLevels.reduce((sum, level) => sum + level * level, 0);
            const totalTrueRms = Math.sqrt(totalSumOfSquares / trimmedLevels.length);
            console.log('Total True RMS audio level = ' + totalTrueRms.toFixed(5));

            // 2. Calculate True RMS per 10-second interval
            console.log('10-second Interval True RMS values:');
            for (let i = 0; i < trimmedLevels.length; i += 10) {
              const chunk = trimmedLevels.slice(i, i + 10);
              const chunkSumOfSquares = chunk.reduce((sum, level) => sum + level * level, 0);
              const chunkRms = Math.sqrt(chunkSumOfSquares / chunk.length);
              
              // This is the exact value the DataPointAggregator will output for this interval
              console.log(`  Interval ${Math.floor(i/10) + 1} (${chunk.length}s): ${chunkRms.toFixed(5)}`);
            }
          }
        }
        
        clearInterval(statsInterval);
        
        // Trigger the stop logic to reset the UI to its clean state
        if (typeof stopButton !== 'undefined') {
          stopButton.click();
        }
        
        // Set and show the warning message AFTER the UI cleanup
        const warningMessage = `Warning: Audio track ended - ${event.type}`;
        errorMessageElement.textContent = warningMessage;
        errorMessageElement.style.display = 'block';
      };
      stopButton.disabled = false;
      recordButton.disabled = false;
      streamControlsContainer.style.display = 'flex';
      audioDevicesContainer.style.display = 'flex';
      snapshotButtonContainer.style.display = 'block';
      visualizeAudio(streamForPlaybackAndVisualizer);
      await populateAudioInputDevices();
      await populateSystemInfo();

      // Display the properties of the audio device that the track is actively using.
      // This is the source of truth, especially when 'undefined' is selected for deviceId,
      // as the browser will choose a default device. We get the deviceId from the
      // track's settings to ensure we display information about the device that is
      // actually in use.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const selectedDevice = devices.find(device => device.kind === 'audioinput' && device.deviceId === audioTrack.getSettings().deviceId);
      if (selectedDevice && micSourceRadio.checked) {
        audioInputDeviceElement.textContent = `Active audio source:\n` +
            `  type: Microphone\n` +
            `  kind: ${selectedDevice.kind}\n` +
            `  label: ${selectedDevice.label}\n` +
            `  deviceId: ${selectedDevice.deviceId}\n` +
            `  groupId: ${selectedDevice.groupId}`;
        audioInputDeviceElement.style.display = 'block';
      } else if (!micSourceRadio.checked) {
        const filename = (currentFileSourceType === 'predefined') ? audioFileSelect.value : (localFileName || 'Local File');
        const duration = fileSourceAudio.duration ? fileSourceAudio.duration.toFixed(2) + 's' : 'Unknown';
        const loop = fileSourceAudio.loop;
        const playbackRate = fileSourceAudio.playbackRate;
        
        audioInputDeviceElement.innerHTML = `Active audio source:\n` +
            `  type: Audio File\n` +
            `  label: ${filename}\n` +
            `  duration: ${duration}\n` +
            `  loop: ${loop}\n` +
            `  playbackRate: ${playbackRate}\n` +
            `  sampleRate: <span id="info-samplerate">Loading...</span>\n` +
            `  channels: <span id="info-channels">Loading...</span>\n` +
            `<span id="info-extra-wav"></span>` +
            `<span id="audio-file-time">time: 0.00s / ${duration}</span>` +
            `<progress id="audio-file-progress" value="0" max="100"></progress>`;
        audioInputDeviceElement.style.display = 'block';
        updateAudioFileProgress();

        // Fetch and update metadata
        getAudioFileMetadata(fileSourceAudio.src).then(metadata => {
            const sampleRateEl = document.getElementById('info-samplerate');
            const channelsEl = document.getElementById('info-channels');
            const extraEl = document.getElementById('info-extra-wav');
            
            if (metadata) {
                if (sampleRateEl) sampleRateEl.textContent = metadata.sampleRate;
                if (channelsEl) channelsEl.textContent = metadata.numberOfChannels;
                
                // Only show extra details if they were parsed (typically from WAV header)
                if (metadata.audioFormat && extraEl) {
                    extraEl.innerHTML = `  sampleSize: ${metadata.bitsPerSample}\n` +
                                        `  format: ${metadata.audioFormat}\n` +
                                        `  byteRate: ${metadata.byteRate}\n` +
                                        `  blockAlign: ${metadata.blockAlign}\n`;
                }
            } else {
                if (sampleRateEl) sampleRateEl.textContent = 'Unknown';
                if (channelsEl) channelsEl.textContent = 'Unknown';
            }
        });

      } else {
        audioInputDeviceElement.style.display = 'none';
      }

      audioPlayback.srcObject = streamForPlaybackAndVisualizer;
      htmlPlayCheckbox.checked = false;
      if (!autoRecordCheckbox || !autoRecordCheckbox.checked) {
        isRecording = false;
        updateRecordButtonUI();
      }

      if (micSourceRadio.checked) {
        applyConstraintsButton.disabled = false;
        dynamicConstraintSelects.forEach(select => {
          select.disabled = false;
          select.parentElement.classList.remove('disabled-setting');
        });
        audioDeviceSelect.disabled = true;
        audioDeviceSelect.parentElement.classList.add('disabled-setting');
      } else {
        applyConstraintsButton.disabled = true;
      }
      updateActionButtonsTooltips();
    } catch (err) {
      console.error(err);
      let errorMsg = '';
      if (err.name === 'OverconstrainedError' && err.constraint) {
        errorMsg = `OverconstrainedError: constraint "${err.constraint}"`;
      } else if (err.message) {
        errorMsg = `Error: ${err.name} - ${err.message}`;
      } else {
        errorMsg = `Error: ${err.name}`;
      }
      errorMessageElement.textContent = errorMsg;
      errorMessageElement.style.display = 'block';
      logLifecycleEvent(micSourceRadio.checked ? 'getUserMedia Error' : 'captureStream Error', errorMsg, 'error');
      gumButton.disabled = false;
      applyConstraintsButton.disabled = true;
      copyBookmarkButton.disabled = false;
      peerConnectionCheckbox.disabled = false;
      dtxCheckbox.disabled = false;
      if (autoRecordCheckbox) {
        autoRecordCheckbox.disabled = false;
      }
      setConstraintsDisabled(false);
      updateActionButtonsTooltips();
    }
  });

  applyConstraintsButton.addEventListener('click', async () => {
    if (!localStream || !micSourceRadio.checked) return;
    const [audioTrack] = localStream.getAudioTracks();
    if (!audioTrack || audioTrack.readyState !== 'live') return;

    // Build the track-level constraints object from the UI dropdowns (echoCancellation,
    // autoGainControl, noiseSuppression, voiceIsolation, channelCount).
    const audioConstraints = buildAudioConstraints();
    console.log('--- applyConstraints() START ---');
    console.log('Target track:', audioTrack.label, `(id: ${audioTrack.id}, readyState: ${audioTrack.readyState})`);
    console.log('Before applyConstraints -> audioTrack.getConstraints() was:', audioTrack.getConstraints());
    console.log('Before applyConstraints -> audioTrack.getSettings() was:', audioTrack.getSettings());
    console.log('Supplied constraints payload to applyConstraints():', JSON.stringify(audioConstraints, null, 2));

    try {
      // Call standard MediaStreamTrack.applyConstraints().
      // Note: In Chromium, applyConstraints() resolves and updates track.getConstraints(),
      // but Chrome's underlying audio capture pipeline (MediaStreamAudioProcessor) does not
      // dynamically reconfigure WebRTC APM filters (AEC/AGC/NS) on an active capture stream.
      // Consequently, track.getSettings() reflects the active pipeline settings (which remain
      // unchanged), while track.getConstraints() reflects the newly requested constraint dictionary.
      await audioTrack.applyConstraints(audioConstraints);
      console.log('audioTrack.applyConstraints() promise resolved successfully.');
      console.log('After applyConstraints -> audioTrack.getConstraints() now returns:', audioTrack.getConstraints());
      console.log('After applyConstraints -> audioTrack.getSettings() now returns:', audioTrack.getSettings());
      console.log('--- applyConstraints() END ---');

      errorMessageElement.textContent = '';
      errorMessageElement.style.display = 'none';

      // Reset to default error colors from CSS
      errorMessageElement.style.color = '';
      errorMessageElement.style.backgroundColor = '';
      errorMessageElement.style.borderColor = '';

      // Determine which constraint keys were requested and evaluate if getSettings() adopted them
      const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
      const requestedKeys = Object.keys(audioConstraints);
      const statusMap = computeConstraintStatusMap(audioConstraints, settings);

      // Update getSettings() with green (applied) / red (not-applied) markers
      updateTrackSettings(audioTrack, statusMap);
      updateTrackProperties(audioTrack);

      // Log the applyConstraints outcome
      const statusSummary = Object.entries(statusMap).map(([k, s]) => `${k}:${s}`).join(', ');
      logLifecycleEvent('applyConstraints', `Requested {${requestedKeys.join(', ')}} -> ${statusSummary}`);

      // Update getConstraints() with yellow requested change markers
      updateTrackConstraints(audioTrack, requestedKeys);

      // Visual feedback on button
      const originalText = applyConstraintsButton.textContent;
      applyConstraintsButton.textContent = 'Applied!';
      setTimeout(() => {
        applyConstraintsButton.textContent = originalText;
      }, 1500);
    } catch (err) {
      console.error('audioTrack.applyConstraints() promise rejected:', err);
      console.log('--- applyConstraints() FAILED ---');
      let errorMsg = '';
      if (err.name === 'OverconstrainedError' && err.constraint) {
        errorMsg = `applyConstraints OverconstrainedError: constraint "${err.constraint}"`;
      } else if (err.message) {
        errorMsg = `applyConstraints Error: ${err.name} - ${err.message}`;
      } else {
        errorMsg = `applyConstraints Error: ${err.name}`;
      }
      errorMessageElement.textContent = errorMsg;
      errorMessageElement.style.display = 'block';
      logLifecycleEvent('applyConstraints Error', errorMsg, 'error');
    }
  });

  /**
   * Displays information about the active audio output device.
   * This function finds the full device details from the enumerated device list
   * using the provided sinkId. This ensures the displayed information accurately
   * reflects the device in use.
   * @param {string} sinkId The sinkId of the audio output device.
   */
  async function updateAudioOutputInfo(sinkId) {
    try {
      if (!('setSinkId' in HTMLMediaElement.prototype)) {
        audioOutputInfoElement.textContent = 'Audio output device selection not supported.';
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      let outputDevice;

      if (sinkId === '') {
        // An empty sinkId means the default device is being used.
        // We'll find the first available audio output device and assume it's the default.
        outputDevice = devices.find(d => d.kind === 'audiooutput');
      } else {
        // A non-empty sinkId means a specific device has been set.
        outputDevice = devices.find(d => d.kind === 'audiooutput' && d.deviceId === sinkId);
      }

      if (outputDevice) {
        audioOutputInfoElement.textContent = `Active audio output device:\n` +
            `  kind: ${outputDevice.kind}\n` +
            `  label: ${outputDevice.label}\n` +
            `  deviceId: ${outputDevice.deviceId}\n` +
            `  groupId: ${outputDevice.groupId}`;
      } else {
        audioOutputInfoElement.textContent = 'Audio output device not found.';
      }
    } catch (err) {
      console.error('Error getting output device info:', err);
      audioOutputInfoElement.textContent = `Error: ${err.name} - ${err.message}`;
    }
  }

  stopButton.addEventListener('click', () => {
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
      streamForPlaybackAndVisualizer = null;
    }
    fileSourceAudio.pause();
    fileSourceAudio.src = '';
    closePeerConnection();
    latestRmsAudioLevel = null;
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (webAudioContext) {
      webAudioContext.close();
      webAudioContext = null;
      webAudioSource = null;
    }
    if (rmsAudioLevels.length > 0) {
      // Trim leading zeros.
      const firstNonZeroIndex = rmsAudioLevels.findIndex((level) => level > 0);
      const trimmedLevels = firstNonZeroIndex === -1 ? [] : rmsAudioLevels.slice(firstNonZeroIndex);
      
      if (trimmedLevels.length > 0) {
        console.log('rmsAudioLevels (trimmed) = ' + JSON.stringify(trimmedLevels));
        
        // 1. Calculate True RMS for the complete duration
        const totalSumOfSquares = trimmedLevels.reduce((sum, level) => sum + level * level, 0);
        const totalTrueRms = Math.sqrt(totalSumOfSquares / trimmedLevels.length);
        console.log('Total True RMS audio level = ' + totalTrueRms.toFixed(5));

        // 2. Calculate True RMS per 10-second interval
        console.log('10-second Interval True RMS values:');
        for (let i = 0; i < trimmedLevels.length; i += 10) {
          const chunk = trimmedLevels.slice(i, i + 10);
          const chunkSumOfSquares = chunk.reduce((sum, level) => sum + level * level, 0);
          const chunkRms = Math.sqrt(chunkSumOfSquares / chunk.length);
          
          // This is the exact value the DataPointAggregator will output for this interval
          console.log(`  Interval ${Math.floor(i/10) + 1} (${chunk.length}s): ${chunkRms.toFixed(5)}`);
        }
      }
    }
    clearInterval(statsInterval);
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    cancelAnimationFrame(fileProgressFrameRequest);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.style.display = 'none';
    audioDevicesContainer.style.display = 'none';
    snapshotButtonContainer.style.display = 'none';
    audioOutputInfoElement.style.display = 'none';
    audioOutputInfoElement.textContent = '';
    gumButton.disabled = false;
    applyConstraintsButton.disabled = true;
    copyBookmarkButton.disabled = false;
    stopButton.disabled = true;
    recordButton.disabled = true;
    updateActionButtonsTooltips();
    setConstraintsDisabled(false);
    peerConnectionCheckbox.disabled = false;
    dtxCheckbox.disabled = false;
    if (autoRecordCheckbox) {
      autoRecordCheckbox.disabled = false;
    }
    audioOutputDeviceSelect.disabled = false;
    latencyHintSelect.disabled = false;
    sampleRateSelect.disabled = false;
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    muteCheckbox.checked = false;
    htmlPlayCheckbox.checked = false;
    webaudioPlayCheckbox.checked = false;
    updateMuteTooltip();
    updateHtmlPlayTooltip();
    updateWebAudioPlayTooltip();
    trackSettingsElement.textContent = '';
    trackPropertiesElement.textContent = '';
    trackStatsElement.textContent = '';
    trackConstraintsElement.textContent = '';
    audioInputDeviceElement.textContent = '';
    if (rtpStatsSectionContainer) {
      rtpStatsSectionContainer.style.display = 'none';
    }
    outboundRtpStatsElement.textContent = '';
    outboundRtpStatsElement.style.display = 'none';
    inboundRtpStatsElement.textContent = '';
    inboundRtpStatsElement.style.display = 'none';
    audioPlayoutStatsElement.textContent = '';
    audioPlayoutStatsElement.style.display = 'none';
    previousStats = null;
    previousTrackProperties = null;
    previousOutboundRtpStats = null;
    previousInboundRtpStats = null;
    previousPlayoutStats = null;
    if (recordedAudioContainer) {
      recordedAudioContainer.style.display = 'none';
    }
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    lastRecordedBlob = null;
    lastRecordedMimeType = '';
    recordedVisualizer.style.display = 'none';
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    isRecording = false;
    updateRecordButtonUI();
    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';
    bookmarkUrlContainer.innerHTML = ''; // Clear the bookmark URL
    // Reset to default error colors from CSS
    errorMessageElement.style.color = '';
    errorMessageElement.style.backgroundColor = '';
    errorMessageElement.style.borderColor = '';
    console.log('Stream stopped and visualizer cleared.');
    logLifecycleEvent('Stream', 'Stream stopped and audio pipeline closed');
  });

  let activeToastTimeout = null;
  function showToastNotification(message, durationMs = 5000) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-notification';
      toast.className = 'toast-notification';
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="toast-dot"></span><span>${message}</span>`;
    void toast.offsetHeight;
    toast.classList.add('show');

    if (activeToastTimeout) {
      clearTimeout(activeToastTimeout);
    }

    activeToastTimeout = setTimeout(() => {
      toast.classList.remove('show');
    }, durationMs);
  }

  function startRecording(isAuto = false) {
    if (!localStream) {
      console.error('Cannot record: No active stream.');
      return;
    }
    isRecording = true;
    updateRecordButtonUI();
    const mimeType = findSupportedMimeType();
    const [audioTrack] = localStream.getAudioTracks();
    const trackInfo = audioTrack ? `track: "${audioTrack.label || 'Audio'}"` : 'track: active';
    logLifecycleEvent(
      'MediaRecorder',
      isAuto
        ? `Auto-recording initiated at time zero (${trackInfo}, mimeType: ${mimeType || 'default'})`
        : `Recording started manually (${trackInfo}, mimeType: ${mimeType || 'default'})`,
      'info'
    );
    if (isAuto) {
      showToastNotification('Auto-recording started at time zero', 5000);
    } else {
      showToastNotification('Recording started', 3000);
    }
    if (recordedAudioContainer) {
      recordedAudioContainer.style.display = 'none';
    }
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    lastRecordedBlob = null;
    lastRecordedMimeType = '';
    recordedVisualizer.style.display = 'none';
    recordedChunks = [];
    try {
      mediaRecorder = new MediaRecorder(localStream, { mimeType });
      mediaRecorder.onstart = () => console.log('MediaRecorder started.', 'MimeType:', mimeType, isAuto ? '(Auto-record)' : '');
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        console.log('MediaRecorder stopped.');
        const recordedBlob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
        lastRecordedBlob = recordedBlob;
        lastRecordedMimeType = mimeType || 'audio/webm';
        const audioUrl = URL.createObjectURL(recordedBlob);
        recordedAudio.src = audioUrl;
        if (recordedAudioContainer) {
          recordedAudioContainer.style.display = 'flex';
        }
        const recordedLabel = document.querySelector('.recorded-label');
        if (recordedLabel) {
          recordedLabel.classList.remove('highlight', 'fade-out');
          void recordedLabel.offsetWidth; // Force reflow
          recordedLabel.classList.add('highlight');
          setTimeout(() => {
            recordedLabel.classList.add('fade-out');
            setTimeout(() => {
              recordedLabel.classList.remove('highlight', 'fade-out');
            }, 1000);
          }, 3600);
        }
        const sizeKb = (recordedBlob.size / 1024).toFixed(1);
        logLifecycleEvent('MediaRecorder', `Recording completed (${sizeKb} KB, ${recordedChunks.length} chunk${recordedChunks.length === 1 ? '' : 's'})`, 'success');
      };
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        errorMessageElement.textContent = `Recorder Error: ${event.error.name}`;
        errorMessageElement.style.display = 'block';
        logLifecycleEvent('MediaRecorder Error', `${event.error.name}: ${event.error.message || 'Unknown error'}`, 'error');
      };
      mediaRecorder.start();
    } catch (err) {
      console.error('Failed to create MediaRecorder:', err);
      isRecording = false;
      updateRecordButtonUI();
      errorMessageElement.textContent = `MediaRecorder Error: ${err.message}`;
      errorMessageElement.style.display = 'block';
      logLifecycleEvent('MediaRecorder Error', `Failed to start: ${err.message}`, 'error');
    }
  }

  function stopRecording() {
    if (!isRecording && (!mediaRecorder || mediaRecorder.state !== 'recording')) return;
    isRecording = false;
    updateRecordButtonUI();
    logLifecycleEvent('MediaRecorder', 'Stop recording requested');
    const toast = document.getElementById('toast-notification');
    if (toast) {
      toast.classList.remove('show');
    }
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  if (downloadRecordedAudioButton) {
    downloadRecordedAudioButton.addEventListener('click', () => {
      if (!recordedAudio.src) return;
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
      const ext = (lastRecordedMimeType || '').includes('ogg') ? 'ogg' : 'webm';
      const filename = `gum-recording-${timestamp}.${ext}`;

      const a = document.createElement('a');
      a.href = recordedAudio.src;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      logLifecycleEvent('MediaRecorder', `Downloaded recording file "${filename}"`, 'info');
      showToastNotification(`Downloaded ${filename}`, 3000);
    });
  }

  recordButton.addEventListener('click', () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording(false);
    }
  });

  recordedAudio.addEventListener('play', () => {
    try {
      console.log('Recorded audio playback started.');
      recordedVisualizer.style.display = 'block';
      
      // Create the context and source node only once.
      if (!recordedAudioContext) {
        console.log('Creating new (and final) recorded audio context.');
        recordedAudioContext = new AudioContext();
        console.log('AudioContext sample rate:', recordedAudioContext.sampleRate);
      }
      
      if (!recordedSourceNode) {
        console.log('Creating new (and final) media element source node.');
        recordedSourceNode = recordedAudioContext.createMediaElementSource(recordedAudio);
      }

      // Always create a new analyser and connect the nodes.
      // Disconnect the source from any *old* analyser first.
      recordedSourceNode.disconnect();

      // Disconnect the old analyser from the destination to avoid memory leaks.
      if (recordedAnalyser) {
        recordedAnalyser.disconnect();
      }
      
      recordedAnalyser = recordedAudioContext.createAnalyser();
      recordedAnalyser.fftSize = 2048;
      recordedSourceNode.connect(recordedAnalyser);
      recordedAnalyser.connect(recordedAudioContext.destination);
      
      drawRecordedVisualizer();
    } catch (err) {
      console.error('Error visualizing recorded audio:', err);
      errorMessageElement.textContent = `Visualization Error: ${err.message}`;
      errorMessageElement.style.display = 'block';
    }
  });

  function stopRecordedVisualization() {
    cancelAnimationFrame(recordedVisualizationFrameRequest);
  }

  recordedAudio.addEventListener('pause', () => {
    console.log('Recorded audio playback paused.');
    stopRecordedVisualization();
  });

  recordedAudio.addEventListener('ended', () => {
    console.log('Recorded audio playback ended.');
    stopRecordedVisualization();
  });

  muteCheckbox.addEventListener('change', () => {
    updateMuteTooltip();
    if (localStream) {
      const [audioTrack] = localStream.getAudioTracks();
      audioTrack.enabled = !muteCheckbox.checked;
      updateTrackProperties(audioTrack);
      logLifecycleEvent('track.enabled', `Track enabled set to ${audioTrack.enabled}`);
    }
  });

  htmlPlayCheckbox.addEventListener('change', async () => {
    updateHtmlPlayTooltip();
    if (streamForPlaybackAndVisualizer) {
      if (htmlPlayCheckbox.checked) {
        const sinkId = audioOutputDeviceSelect.value;
        try {
          if ('setSinkId' in audioPlayback) {
            // An empty string sets the output to the user-agent default device.
            const deviceIdToSet = sinkId === 'undefined' ? '' : sinkId;
            await audioPlayback.setSinkId(deviceIdToSet);
            console.log(`Audio output device set to: ${deviceIdToSet || 'default'}`);
          }
          await audioPlayback.play();
          await updateAudioOutputInfo(audioPlayback.sinkId);
          audioOutputInfoElement.style.display = 'block';
          audioOutputDeviceSelect.disabled = true;
          logLifecycleEvent('HTML:Play', `Playback started (sinkId: ${audioOutputDeviceSelect.value || 'default'})`);
        } catch (err) {
          console.error('Error setting audio output device:', err);
          errorMessageElement.textContent = `Error setting sinkId: ${err.name} - ${err.message}`;
          errorMessageElement.style.display = 'block';
          // Revert the UI state since we failed.
          htmlPlayCheckbox.checked = false;
          updateHtmlPlayTooltip();
          audioOutputDeviceSelect.disabled = false;
          logLifecycleEvent('HTML:Play', `Failed to start playback (${err.name})`);
        }
      } else {
        await audioPlayback.pause();
        audioOutputInfoElement.style.display = 'none';
        audioOutputDeviceSelect.disabled = false;
        logLifecycleEvent('HTML:Play', 'Playback stopped');
      }
    }
  });

  webaudioPlayCheckbox.addEventListener('change', async () => {
    updateWebAudioPlayTooltip();
    if (streamForPlaybackAndVisualizer) {
      if (webaudioPlayCheckbox.checked) {
        try {
          if (!webAudioContext || webAudioContext.state === 'closed') {
            const latencyHint = latencyHintSelect.value;
            const sampleRate = sampleRateSelect.value;
            const contextOptions = {};
            if (latencyHint !== 'undefined') {
              contextOptions.latencyHint = latencyHint;
            }
            if (sampleRate !== 'undefined') {
              contextOptions.sampleRate = parseInt(sampleRate, 10);
            }
            console.log('AudioContext contextOptions:', contextOptions);
            webAudioContext = new AudioContext(contextOptions);
            console.log('AudioContext base latency:', webAudioContext.baseLatency);
          }

          const sinkId = audioOutputDeviceSelect.value;
          if ('setSinkId' in webAudioContext) {
            const deviceIdToSet = sinkId === 'undefined' ? '' : sinkId;
            await webAudioContext.setSinkId(deviceIdToSet);
            console.log(`Audio output device set to: ${deviceIdToSet || 'default'}`);
          }

          webAudioSource = webAudioContext.createMediaStreamSource(streamForPlaybackAndVisualizer);
          webAudioSource.connect(webAudioContext.destination);

          if (webAudioContext.state === 'suspended') {
            await webAudioContext.resume();
          }
          await updateAudioOutputInfo(webAudioContext.sinkId);
          audioOutputInfoElement.style.display = 'block';
          audioOutputDeviceSelect.disabled = true;
          latencyHintSelect.disabled = true;
          sampleRateSelect.disabled = true;
          logLifecycleEvent('WebAudio:Play', `AudioContext playback started (sampleRate: ${webAudioContext.sampleRate}Hz, baseLatency: ${(webAudioContext.baseLatency * 1000).toFixed(1)}ms)`);
        } catch (err) {
          console.error('WebAudio Playback setup failed:', err);
          errorMessageElement.textContent = `WebAudio Error: ${err.message}`;
          errorMessageElement.style.display = 'block';
          webaudioPlayCheckbox.checked = false;
          updateWebAudioPlayTooltip();
          audioOutputDeviceSelect.disabled = false;
          latencyHintSelect.disabled = false;
          sampleRateSelect.disabled = false;
          if (webAudioContext) {
            webAudioContext.close();
            webAudioContext = null;
          }
          logLifecycleEvent('WebAudio:Play', `Failed to start AudioContext playback (${err.message})`);
        }
      } else {
        if (webAudioContext) {
          await webAudioContext.close();
          webAudioContext = null;
          webAudioSource = null;
        }
        audioOutputInfoElement.style.display = 'none';
        audioOutputDeviceSelect.disabled = false;
        latencyHintSelect.disabled = false;
        sampleRateSelect.disabled = false;
        logLifecycleEvent('WebAudio:Play', 'AudioContext playback stopped');
      }
    }
  });

  audioPlayback.addEventListener('play', async () => {
    console.log('Audio playback started.');
    await updateAudioOutputInfo(audioPlayback.sinkId);
    audioOutputInfoElement.style.display = 'block';
  });

  audioPlayback.addEventListener('pause', () => {
    console.log('Audio playback paused.');
  });

  navigator.mediaDevices.addEventListener('devicechange', async () => {
    console.log('--- navigator.mediaDevices "devicechange" event received ---');

    // Check if the currently active microphone device was disconnected
    if (localStream && micSourceRadio.checked) {
      const [audioTrack] = localStream.getAudioTracks();
      if (audioTrack) {
        const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
        const activeDeviceId = settings.deviceId;
        console.log('devicechange: inspecting active audio track:', {
          label: audioTrack.label,
          activeDeviceId: activeDeviceId || 'undefined/default',
          readyState: audioTrack.readyState
        });

        try {
          const devices = await navigator.mediaDevices.enumerateDevices();
          const audioInputs = devices.filter(d => d.kind === 'audioinput');

          let isDisconnected = false;
          if (activeDeviceId && activeDeviceId !== 'default') {
            if (!audioInputs.some(d => d.deviceId === activeDeviceId)) {
              isDisconnected = true;
            }
          } else if (audioInputs.length === 0 || audioTrack.readyState === 'ended') {
            isDisconnected = true;
          }

          if (isDisconnected) {
            console.warn(`devicechange: active audio device "${audioTrack.label || activeDeviceId}" is no longer available. Stopping stream.`);
            const label = audioTrack.label || 'Microphone';
            logLifecycleEvent('devicechange', `Active mic disconnected (${label})`);
            stopButton.click();
            errorMessageElement.textContent = `Warning: Active audio input device disconnected (${label}). Stream stopped.`;
            errorMessageElement.style.display = 'block';
          } else {
            console.log(`devicechange: active audio device "${audioTrack.label || activeDeviceId}" is still connected.`);
          }
        } catch (e) {
          console.warn('Error checking device disconnection on devicechange:', e);
        }
      }
    }

    await populateAudioInputDevices();
    await populateAudioOutputDevices();
    await populateSystemInfo();
    console.log('devicechange: device lists and System Diagnostics updated.');
    logLifecycleEvent('devicechange', `Device lists and system diagnostics refreshed`);
  });

  copyBookmarkButton.addEventListener('click', () => {
    // Create a new URLSearchParams object to build the query string.
    const params = new URLSearchParams();
    // Helper function to add a parameter to the search params if its value is not 'undefined'.
    const addParam = (name, selectElement) => {
      const value = selectElement.value;
      if (value !== 'undefined') {
        params.set(name, value);
      }
    };

    if (micSourceRadio.checked) {
      // Add the current constraint values to the search parameters.
      addParam('echoCancellation', echoCancellationSelect);
      addParam('autoGainControl', autoGainControlSelect);
      addParam('noiseSuppression', noiseSuppressionSelect);
      if (isVoiceIsolationSupported && voiceIsolationSelect) {
        addParam('voiceIsolation', voiceIsolationSelect);
      }
      addParam('channelCount', channelCountSelect);
      if (latencyConstraintSelect) {
        addParam('latency', latencyConstraintSelect);
      }
      if (sampleRateConstraintSelect) {
        addParam('sampleRate', sampleRateConstraintSelect);
      }
      if (sampleSizeConstraintSelect) {
        addParam('sampleSize', sampleSizeConstraintSelect);
      }
      addParam('deviceId', audioDeviceSelect);
      params.set('inputSource', 'microphone');
    } else {
      params.set('inputSource', 'file');
      params.set('audioFile', audioFileSelect.value);
    }

    if (peerConnectionCheckbox.checked) {
      params.set('peerConnection', 'true');
    }

    if (dtxCheckbox.checked) {
      params.set('dtx', 'true');
    }

    if (autoRecordCheckbox && autoRecordCheckbox.checked) {
      params.set('autoRecord', 'true');
    }

    // Construct the full bookmarkable URL, only adding a '?' if there are parameters.
    const queryString = params.toString();
    const bookmarkUrl = queryString
      ? `${window.location.origin}${window.location.pathname}?${queryString}`
      : `${window.location.origin}${window.location.pathname}`;
    console.log('Bookmark URL:', bookmarkUrl);
    
    // Use the Clipboard API to copy the URL to the user's clipboard.
    navigator.clipboard.writeText(bookmarkUrl).then(() => {
      // Provide visual feedback to the user on the button itself.
      const originalText = copyBookmarkButton.textContent;
      copyBookmarkButton.textContent = 'Copied!';
      // Revert the button text after a short delay.
      setTimeout(() => {
        copyBookmarkButton.textContent = originalText;
      }, 2000);
    }).catch(err => {
      // Log an error if the clipboard write fails.
      console.error('Failed to copy URL: ', err);
    });

    // Create and display a clickable version of the URL at the bottom of the page.
    bookmarkUrlContainer.innerHTML = ''; // Clear any previous link.
    bookmarkUrlContainer.textContent = 'Bookmark URL: ';
    const link = document.createElement('a');
    link.href = bookmarkUrl;
    link.textContent = bookmarkUrl;
    link.target = '_blank'; // Ensure the link opens in a new tab.
    bookmarkUrlContainer.appendChild(link);
  });

  let lastPermissionStatus = 'Unknown';

  function getBrowserInfo() {
    const ua = navigator.userAgent;
    let tem;
    let M = ua.match(/(opera|chrome|safari|firefox|msie|trident(?=\/))\/?\s*(\d+)/i) || [];
    if (/trident/i.test(M[1])) {
      tem = /\brv[ :]+(\d+)/g.exec(ua) || [];
      return { name: 'IE', version: (tem[1] || '') };
    }
    if (M[1] === 'Chrome') {
      tem = ua.match(/\b(OPR|Edg)\/(\d+)/);
      if (tem != null) return { name: tem[1].replace('OPR', 'Opera'), version: tem[2] };
    }
    M = M[2] ? [M[1], M[2]] : [navigator.appName, navigator.appVersion, '-?'];
    if ((tem = ua.match(/version\/(\d+)/i)) != null) M.splice(1, 1, tem[1]);
    return {
      name: M[0],
      version: M[1]
    };
  }

  function getOSInfo() {
    const ua = navigator.userAgent;
    if (ua.indexOf("Win") !== -1) return "Windows";
    if (ua.indexOf("Mac") !== -1) return "MacOS";
    if (ua.indexOf("Linux") !== -1) return "Linux";
    if (ua.indexOf("Android") !== -1) return "Android";
    if (ua.indexOf("like Mac") !== -1) return "iOS";
    return "Unknown OS";
  }

  async function populateSystemInfo() {
    const infoDiv = document.getElementById('system-info-details');
    if (!infoDiv) return;

    const browser = getBrowserInfo();
    const os = getOSInfo();
    const isSecure = window.isSecureContext;
    const protocol = window.location.protocol;
    const host = window.location.host;

    const gumSupported = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const applyConstraintsSupported = typeof MediaStreamTrack !== 'undefined' && ('applyConstraints' in MediaStreamTrack.prototype);
    const setSinkIdSupported = typeof HTMLMediaElement !== 'undefined' && ('setSinkId' in HTMLMediaElement.prototype);
    const peerConnectionSupported = typeof RTCPeerConnection !== 'undefined';
    const mediaRecorderSupported = typeof MediaRecorder !== 'undefined';
    const audioContextSupported = !!(window.AudioContext || window.webkitAudioContext);
    const statsSupported = typeof MediaStreamTrack !== 'undefined' && ('stats' in MediaStreamTrack.prototype);
    const captureStreamSupported = typeof HTMLMediaElement !== 'undefined' && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype);
    const computePressureSupported = typeof PressureObserver !== 'undefined';

    let permissionStatus = 'Unknown';
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const status = await navigator.permissions.query({ name: 'microphone' });
        permissionStatus = status.state; // 'granted', 'prompt', 'denied'
        lastPermissionStatus = permissionStatus;

        // Auto-refresh when user updates permissions
        status.onchange = () => {
          populateSystemInfo();
          populateAudioInputDevices();
        };
      } catch (e) {
        permissionStatus = `Error: ${e.message}`;
        lastPermissionStatus = permissionStatus;
      }
    }

    let permissionColor = 'orange';
    if (permissionStatus === 'granted') permissionColor = 'green';
    if (permissionStatus === 'denied') permissionColor = 'red';

    // 1. System Resources
    const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Cores` : null;
    const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : null;
    const systemResources = [cores, mem].filter(Boolean).join(', ') || 'N/A';

    // 2. Audio Hardware & Context defaults
    let hwSampleRate = 'N/A';
    let hwBaseLatency = 'N/A';
    let hwOutputLatency = 'N/A';
    if (audioContextSupported) {
      try {
        const probeCtx = new (window.AudioContext || window.webkitAudioContext)();
        hwSampleRate = `${probeCtx.sampleRate} Hz`;
        if (typeof probeCtx.baseLatency === 'number') {
          hwBaseLatency = `${(probeCtx.baseLatency * 1000).toFixed(1)} ms`;
        }
        if (typeof probeCtx.outputLatency === 'number') {
          hwOutputLatency = `${(probeCtx.outputLatency * 1000).toFixed(1)} ms`;
        }
        probeCtx.close();
      } catch (e) {
        console.warn('Probe AudioContext error:', e);
      }
    }

    // 3. Detected Audio Devices
    let audioInputsCount = 0;
    let audioOutputsCount = 0;
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioInputsCount = devices.filter(d => d.kind === 'audioinput').length;
        audioOutputsCount = devices.filter(d => d.kind === 'audiooutput').length;
      } catch (e) {
        console.warn('Enumerate devices error in system diagnostics:', e);
      }
    }

    if (previousAudioInputsCount !== null && audioInputsCount !== previousAudioInputsCount) {
      audioInputsHighlightExpiry = Date.now() + 5000;
    }
    if (previousAudioOutputsCount !== null && audioOutputsCount !== previousAudioOutputsCount) {
      audioOutputsHighlightExpiry = Date.now() + 5000;
    }

    previousAudioInputsCount = audioInputsCount;
    previousAudioOutputsCount = audioOutputsCount;

    const isInputsHighlighted = Date.now() < audioInputsHighlightExpiry;
    const isOutputsHighlighted = Date.now() < audioOutputsHighlightExpiry;

    const inputsText = `${audioInputsCount} Audio Input${audioInputsCount !== 1 ? 's' : ''} (mic)`;
    const outputsText = `${audioOutputsCount} Audio Output${audioOutputsCount !== 1 ? 's' : ''} (speaker)`;

    const displayedInputs = isInputsHighlighted
      ? `<span id="highlight-audio-inputs" class="highlight">${inputsText}</span>`
      : inputsText;
    const displayedOutputs = isOutputsHighlighted
      ? `<span id="highlight-audio-outputs" class="highlight">${outputsText}</span>`
      : outputsText;

    // 4. Supported Audio Constraints
    const supConstraints = navigator.mediaDevices?.getSupportedConstraints?.() || {};
    const constraintsSummary = [
      `echoCancellation:${supConstraints.echoCancellation ? '✅' : '❌'}`,
      `autoGainControl:${supConstraints.autoGainControl ? '✅' : '❌'}`,
      `noiseSuppression:${supConstraints.noiseSuppression ? '✅' : '❌'}`,
      `voiceIsolation:${supConstraints.voiceIsolation ? '✅' : '❌'}`,
      `channelCount:${supConstraints.channelCount ? '✅' : '❌'}`,
      `latency:${supConstraints.latency ? '✅' : '❌'}`,
      `sampleRate:${supConstraints.sampleRate ? '✅' : '❌'}`,
      `sampleSize:${supConstraints.sampleSize ? '✅' : '❌'}`,
    ].join(', ');

    infoDiv.innerHTML = `
      <strong>Browser:</strong> ${browser.name} ${browser.version} (${os})<br>
      <strong>Secure Context:</strong> ${isSecure ? '<span style="color: green; font-weight:bold;">Yes</span>' : '<span style="color: red; font-weight:bold;">No (getUserMedia will fail)</span>'}<br>
      <strong>Microphone Permission:</strong> <span style="color: ${permissionColor}; font-weight:bold;">${permissionStatus}</span><br>
      <strong>Origin:</strong> ${protocol}//${host}<br>
      <strong>System Resources:</strong> ${systemResources}<br>
      <strong>Hardware Audio:</strong> Sample Rate: ${hwSampleRate}, Base Latency: ${hwBaseLatency}, Output Latency: ${hwOutputLatency}<br>
      <strong>Detected Devices:</strong> ${displayedInputs}, ${displayedOutputs}<br>
      <strong>Compute Pressure (CPU):</strong> <span id="compute-pressure-status">${formatComputePressureHtml(latestComputePressure)}</span> <button id="simulate-pressure-cycle-btn" style="margin-left: 8px; font-size: 10px; padding: 1px 6px; cursor: pointer; border: 1px solid #aaa; border-radius: 3px; background: #fff;">Simulate Cycle</button> <select id="simulate-pressure-select" style="margin-left: 4px; font-size: 10px; padding: 1px 2px;"><option value="" disabled selected>Set State...</option><option value="nominal">🟢 nominal (25%)</option><option value="fair">🟡 fair (50%)</option><option value="serious">🟠 serious (75%)</option><option value="critical">🔴 critical (100%)</option></select><br>
      <div id="compute-pressure-graph-container" style="margin: 6px 0; padding: 6px 8px; background: #ffffff; border: 1px solid #d0d5dd; border-radius: 4px; width: 100%; box-sizing: border-box;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
          <span style="font-weight: bold; font-size: 10px; color: #495057;">Compute Pressure History (1Hz Mapped States)</span>
          <span id="compute-pressure-graph-legend" style="font-size: 9px; color: #666;">
            <span style="color: #2E7D32;">● light (25%)</span> |
            <span style="color: #F57F17;">● moderate (50%)</span> |
            <span style="color: #E65100;">● high (75%)</span> |
            <span style="color: #C62828;">● heavy (100%)</span>
          </span>
        </div>
        <canvas id="compute-pressure-canvas" height="85" style="width: 100%; height: 85px; display: block; border: 1px solid #eee; border-radius: 2px;"></canvas>
      </div>
      <strong>APIs Supported:</strong> getUserMedia:${gumSupported ? '✅' : '❌'}, applyConstraints:${applyConstraintsSupported ? '✅' : '❌'}, setSinkId:${setSinkIdSupported ? '✅' : '❌'}, RTCPeerConnection:${peerConnectionSupported ? '✅' : '❌'}, MediaRecorder:${mediaRecorderSupported ? '✅' : '❌'}, Web Audio:${audioContextSupported ? '✅' : '❌'}, Track Stats:${statsSupported ? '✅' : '❌'}, captureStream:${captureStreamSupported ? '✅' : '❌'}, Compute Pressure:${computePressureSupported ? '✅' : '❌'}<br>
      <strong>Supported Constraints:</strong> ${constraintsSummary}<br>
      <details style="margin-top: 4px; cursor: pointer;">
        <summary style="font-size: 10px; color: #666;">Raw User Agent</summary>
        <pre style="margin: 3px 0 0 0; font-size: 10px; white-space: pre-wrap; background: #e9ecef; padding: 4px 6px; border-radius: 3px;">${navigator.userAgent}</pre>
      </details>
    `;

    renderComputePressureGraph();

    if (isInputsHighlighted) {
      if (audioInputsFadeTimer) clearTimeout(audioInputsFadeTimer);
      const remainingMs = Math.max(0, audioInputsHighlightExpiry - Date.now());
      audioInputsFadeTimer = setTimeout(() => {
        const el = document.getElementById('highlight-audio-inputs');
        if (el) el.classList.add('fade-out');
      }, remainingMs);
    }

    if (isOutputsHighlighted) {
      if (audioOutputsFadeTimer) clearTimeout(audioOutputsFadeTimer);
      const remainingMs = Math.max(0, audioOutputsHighlightExpiry - Date.now());
      audioOutputsFadeTimer = setTimeout(() => {
        const el = document.getElementById('highlight-audio-outputs');
        if (el) el.classList.add('fade-out');
      }, remainingMs);
    }
  }

  /**
   * Handles the click event of the 'Save Snapshot' button. It gathers all the displayed track
   * and device information, formats it into a structured JSON object, and triggers a download
   * for the user.
   */
  async function handleSaveSnapshot() {
    /**
     * Parses the text content of a <pre> element that is expected to contain a title line
     * followed by a JSON string.
     * @param {string} text - The text content from the <pre> element.
     * @returns {object|string|null} A parsed JavaScript object, the original text on failure, or null.
     */
    const parseJsonContent = (text) => {
      if (!text) return null;
      // Find the first newline to separate the title from the JSON content.
      const firstNewlineIndex = text.indexOf('\n');
      if (firstNewlineIndex === -1) return text; // No newline found, return as is.
      // Extract the JSON string part.
      const jsonString = text.substring(firstNewlineIndex + 1);
      try {
        // Attempt to parse the extracted string as JSON.
        return JSON.parse(jsonString);
      } catch (e) {
        console.error('Failed to parse JSON content:', { content: jsonString, error: e });
        return text; // Fallback to original text if parsing fails.
      }
    };

    /**
     * Parses the text content of a <pre> element that displays device information in a
     * 'key: value' format.
     * @param {string} text - The text content from the <pre> element.
     * @returns {object|null} An object with key-value pairs or null if input is empty.
     */
    const parseDeviceInfo = (text) => {
      if (!text) return null;
      // Split the text into lines and skip the first line (the title).
      const lines = text.split('\n').slice(1);
      const deviceInfo = {};
      // Process each line to extract key-value pairs.
      lines.forEach(line => {
        const parts = line.trim().split(': ');
        if (parts.length === 2) {
          deviceInfo[parts[0]] = parts[1];
        }
      });
      return deviceInfo;
    };

    // Build the MediaStreamTrack getters and properties sub-object.
    const trackSection = {
      'getConstraints()': parseJsonContent(trackConstraintsElement.textContent),
      'getSettings()': parseJsonContent(trackSettingsElement.textContent),
      'properties': parseJsonContent(trackPropertiesElement.textContent),
      'stats': parseJsonContent(trackStatsElement.textContent),
    };
    for (const key in trackSection) {
      const value = trackSection[key];
      if (value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0)) {
        delete trackSection[key];
      }
    }

    // Build the RTCPeerConnection audio reports sub-object.
    const rtpStatsSection = {
      'outbound-rtp (pc1)': parseJsonContent(outboundRtpStatsElement.textContent),
      'inbound-rtp (pc2)': parseJsonContent(inboundRtpStatsElement.textContent),
      'audio-playout (pc2)': parseJsonContent(audioPlayoutStatsElement.textContent),
    };
    for (const key in rtpStatsSection) {
      const value = rtpStatsSection[key];
      if (value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0)) {
        delete rtpStatsSection[key];
      }
    }

    const browser = getBrowserInfo();
    const os = getOSInfo();
    let probeCtx = null;
    let hwSampleRate = 'N/A';
    let hwBaseLatency = 'N/A';
    let hwOutputLatency = 'N/A';
    try {
      probeCtx = (typeof AudioContext !== 'undefined' || typeof webkitAudioContext !== 'undefined') ?
        new (window.AudioContext || window.webkitAudioContext)() : null;
      if (probeCtx) {
        hwSampleRate = `${probeCtx.sampleRate} Hz`;
        if (typeof probeCtx.baseLatency === 'number') {
          hwBaseLatency = `${(probeCtx.baseLatency * 1000).toFixed(1)} ms`;
        }
        if (typeof probeCtx.outputLatency === 'number') {
          hwOutputLatency = `${(probeCtx.outputLatency * 1000).toFixed(1)} ms`;
        }
        probeCtx.close();
      }
    } catch (e) {
      console.warn('Probe AudioContext in snapshot error:', e);
    }

    let audioInputsCount = 0;
    let audioOutputsCount = 0;
    if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        audioInputsCount = devices.filter(d => d.kind === 'audioinput').length;
        audioOutputsCount = devices.filter(d => d.kind === 'audiooutput').length;
      } catch (e) {
        console.warn('Enumerate devices in snapshot error:', e);
      }
    }

    const systemDiagnostics = {
      'Browser': `${browser.name} ${browser.version} (${os})`,
      'Secure Context': window.isSecureContext,
      'Microphone Permission': lastPermissionStatus || 'Unknown',
      'Origin': `${window.location.protocol}//${window.location.host}`,
      'System Resources': {
        'Logical Cores': navigator.hardwareConcurrency || 'N/A',
        'Device Memory (GB)': navigator.deviceMemory || 'N/A',
      },
      'Hardware Audio': {
        'Native Sample Rate': hwSampleRate,
        'Base Latency': hwBaseLatency,
        'Output Latency': hwOutputLatency,
      },
      'Detected Devices': {
        'Audio Inputs (mics)': audioInputsCount,
        'Audio Outputs (speakers)': audioOutputsCount,
      },
      'Compute Pressure (CPU)': {
        'Supported': typeof PressureObserver !== 'undefined',
        'State': latestComputePressure.state,
        'Value (%)': getComputePressureValue(latestComputePressure.state),
        'Factors': latestComputePressure.factors || [],
        'Recent History': computePressureHistory.slice(-15).map(h => ({
          time: new Date(h.time).toTimeString().split(' ')[0],
          state: h.state,
          value: `${h.value}%`,
          factors: h.factors,
          simulated: h.isSimulated || false,
        })),
      },
      'APIs Supported': {
        'getUserMedia': !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
        'applyConstraints': typeof MediaStreamTrack !== 'undefined' && ('applyConstraints' in MediaStreamTrack.prototype),
        'setSinkId': typeof HTMLMediaElement !== 'undefined' && ('setSinkId' in HTMLMediaElement.prototype),
        'RTCPeerConnection': typeof RTCPeerConnection !== 'undefined',
        'MediaRecorder': typeof MediaRecorder !== 'undefined',
        'Web Audio': !!(window.AudioContext || window.webkitAudioContext),
        'Track Stats API': typeof MediaStreamTrack !== 'undefined' && ('stats' in MediaStreamTrack.prototype),
        'captureStream': typeof HTMLMediaElement !== 'undefined' && ('captureStream' in HTMLMediaElement.prototype || 'mozCaptureStream' in HTMLMediaElement.prototype),
        'Compute Pressure (PressureObserver)': typeof PressureObserver !== 'undefined',
      },
      'Supported Constraints': navigator.mediaDevices?.getSupportedConstraints?.() || {},
      'User Agent': navigator.userAgent,
    };

    // Create the main snapshot object.
    const snapshot = {
      'System Diagnostics': systemDiagnostics,
      'Input Source Type': micSourceRadio.checked ? 'Microphone' : 'Audio File',
      'Auto-Record': autoRecordCheckbox ? autoRecordCheckbox.checked : false,
      'Active audio source': parseDeviceInfo(audioInputDeviceElement.textContent),
      'Active audio output device': parseDeviceInfo(audioOutputInfoElement.textContent),
      'WebAudio latencyHint': latencyHintSelect.value,
      'WebAudio sampleRate': sampleRateSelect.value,
      'Audio output sinkId': audioOutputDeviceSelect.value,
      'MediaStreamTrack (Audio) Getters & Properties': trackSection,
      'RTCPeerConnection (getStats() Audio Reports)': rtpStatsSection,
      'Lifecycle Activity Log': lifecycleEvents.map(e => ({
        time: e.time,
        level: e.level,
        category: e.category,
        message: e.message,
      })),
    };

    // Clean up the snapshot by removing any sections that are empty or null.
    for (const key in snapshot) {
      const value = snapshot[key];
      if (value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0)) {
        delete snapshot[key];
      }
    }

    // Convert the final snapshot object to a nicely formatted JSON string.
    const snapshotJson = JSON.stringify(snapshot, null, 2);
    console.log('snapshotJson:', snapshotJson);
    // Create a Blob to hold the JSON data.
    const blob = new Blob([snapshotJson], { type: 'application/json' });
    // Create a temporary URL for the Blob.
    const url = URL.createObjectURL(blob);

    // Create a temporary anchor element to trigger the file download.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'gUM-snapshot.json'; // Set the desired filename.
    document.body.appendChild(a);
    a.click(); // Programmatically click the anchor to start the download.
    document.body.removeChild(a); // Clean up by removing the anchor.
    URL.revokeObjectURL(url); // Release the created object URL.
  }

  saveSnapshotButton.addEventListener('click', handleSaveSnapshot);

  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'simulate-pressure-cycle-btn') {
      runComputePressureCycle();
    }
  });

  document.addEventListener('change', (e) => {
    if (e.target && e.target.id === 'simulate-pressure-select') {
      const selected = e.target.value;
      if (selected) {
        const factors = (selected === 'serious' || selected === 'critical') ? ['thermal'] : [];
        setComputePressureState(selected, factors, true);
        e.target.value = '';
      }
    }
  });

  const systemInfoContainer = document.getElementById('system-info-container');
  if (systemInfoContainer) {
    systemInfoContainer.addEventListener('toggle', () => {
      if (systemInfoContainer.open) {
        setTimeout(renderComputePressureGraph, 20);
      }
    });
  }

  window.addEventListener('resize', () => {
    if (systemInfoContainer && systemInfoContainer.open) {
      renderComputePressureGraph();
    }
  });

  // Initialize the application by populating system info, devices, compute pressure, and then applying URL parameters.
  await initComputePressureObserver();
  populateSystemInfo();
  await populateAudioInputDevices();
  await populateAudioOutputDevices();
  applyUrlParameters();
});