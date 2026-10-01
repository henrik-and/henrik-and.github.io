'use strict';

import { createSilentAudioContext, debugLog, escapeHtml } from './util.js';
import { insertStereoSupportForOpus, insertDtxSupportForOpus } from './sdp.js';
import { getAudioFileMetadata } from './wav.js';
import {
  getAudioHardwareInfo,
  getBrowserInfo,
  getOSInfo,
  invalidateAudioHardwareInfo,
} from './sysinfo.js';
import { lifecycleEvents, logLifecycleEvent } from './lifecycle-log.js';
import {
  computePressureHistory,
  formatComputePressureHtml,
  getComputePressureValue,
  initComputePressureObserver,
  latestComputePressure,
  renderComputePressureGraph,
  runComputePressureCycle,
  setComputePressureState,
} from './compute-pressure.js';
import {
  hasRecordedLevelMeter,
  hideAudioLevelLabel,
  showAudioLevelLabel,
  startRecordedLevelMeter,
  stopRecordedLevelMeter,
  stopVisualizer,
  visualizeAudio,
} from './visualizer.js';
import { initTooltipA11y, labelInfoIcons } from './a11y.js';

document.addEventListener('DOMContentLoaded', async () => {
  const supportedConstraints = navigator.mediaDevices?.getSupportedConstraints?.() || {};
  debugLog('Supported constraints:', supportedConstraints);
  const isVoiceIsolationSupported = !!supportedConstraints.voiceIsolation;
  const gumButton = document.getElementById('gum-button');
  const applyConstraintsButton = document.getElementById('apply-constraints-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const voiceIsolationContainer = document.getElementById('voiceIsolation-container');
  const voiceIsolationSelect = document.getElementById('voiceIsolation');
  if (isVoiceIsolationSupported && voiceIsolationContainer) {
    voiceIsolationContainer.hidden = false;
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
  const renderSizeHintSelect = document.querySelector('#renderSizeHint');
  const renderSizeHintCustomInput = document.querySelector('#renderSizeHintCustom');
  const webaudioQuantumBadge = document.querySelector('#webaudio-quantum-badge');
  
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
  const webaudioContextInfoElement = document.querySelector('#webaudio-context-info');
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
  const autoPlayCheckbox = document.getElementById('auto-play-checkbox');
  const autoPlayLabel = document.querySelector('label[for="auto-play-checkbox"]');
  // Optional: without it Auto-Play uses HTML:Play.
  const autoPlayModeSelect = document.getElementById('auto-play-mode');
  const autoPlayModeName = () =>
    autoPlayModeSelect && autoPlayModeSelect.value === 'webaudio' ? 'WebAudio:Play' : 'HTML:Play';
  // The select is locked together with the Auto-Play checkbox (while a stream runs).
  const syncAutoPlayMode = () => {
    if (autoPlayModeSelect && autoPlayCheckbox) {
      autoPlayModeSelect.disabled = autoPlayCheckbox.disabled;
    }
  };
  const sineToneCheckbox = document.getElementById('sine-tone-checkbox');
  const sineToneLabel = document.querySelector('label[for="sine-tone-checkbox"]');
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
  let sineToneContext = null;
  let sineToneOscillator = null;
  let sineToneGain = null;
  let sineToneDestination = null;
  let sineToneStream = null;
  // True while MediaRecorder records the sine tone track instead of the mic.
  let recordingSineTone = false;
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
  const GLITCH_WINDOW_SIZE = 10;
  const glitchWindow = [];
  let simulatedGlitchMode = 'none'; // 'none', 'minor', 'degraded'
  let simulatedGlitchCumulativeEvents = 0;
  let simulatedGlitchCumulativeDuration = 0;
  let glitchSimulationTimer = null;
  let currentFileSourceType = 'predefined'; // 'predefined' or 'local'
  let localFileBlobUrl = null;
  let localFileName = '';
  let previousAudioInputsCount = null;
  let previousAudioOutputsCount = null;
  let audioInputsHighlightExpiry = 0;
  let audioOutputsHighlightExpiry = 0;
  let audioInputsFadeTimer = null;
  let audioOutputsFadeTimer = null;

  // Source of truth for the Save Snapshot export. Every place that renders one
  // of the info/stat boxes also stores the underlying data here, so the JSON
  // export no longer depends on parsing the rendered <pre> text.
  const snapshotState = {
    audioSource: null,
    audioOutput: null,
    webAudioContext: null,
    trackConstraints: null,
    trackSettings: null,
    trackProperties: null,
    trackStats: null,
    outboundRtp: null,
    inboundRtp: null,
    audioPlayout: null,
  };

  function setSimulatedGlitchMode(mode) {
    simulatedGlitchMode = mode;
    const select = document.getElementById('simulate-glitch-select');
    if (select && select.value !== mode) {
      select.value = mode;
    }
    if (mode === 'minor') {
      logLifecycleEvent('RTCPeerConnection', 'Audio playout glitch simulation: Minor (+1 event)', 'warning');
    } else if (mode === 'degraded') {
      logLifecycleEvent('RTCPeerConnection', 'Audio playout glitch simulation: Degraded (heavy bursts)', 'warning');
    } else if (mode === 'none') {
      logLifecycleEvent('RTCPeerConnection', 'Audio playout glitch simulation: Off (Live stats)', 'info');
    }
  }

  function runGlitchSimulationCycle() {
    if (glitchSimulationTimer) {
      clearInterval(glitchSimulationTimer);
      glitchSimulationTimer = null;
    }
    const btn = document.getElementById('simulate-glitch-cycle-btn');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Simulating...';
    }

    let cycleStep = 0;
    setSimulatedGlitchMode('none');

    glitchSimulationTimer = setInterval(() => {
      cycleStep++;
      if (cycleStep === 3) {
        setSimulatedGlitchMode('minor');
      } else if (cycleStep === 6) {
        setSimulatedGlitchMode('degraded');
      } else if (cycleStep >= 11) {
        setSimulatedGlitchMode('none');
        clearInterval(glitchSimulationTimer);
        glitchSimulationTimer = null;
        const b = document.getElementById('simulate-glitch-cycle-btn');
        if (b) {
          b.disabled = false;
          b.textContent = 'Simulate Cycle';
        }
      }
    }, 1000);
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

  function startSineToneGenerator() {
    if (sineToneContext && sineToneContext.state !== 'closed') {
      return sineToneStream;
    }
    try {
      sineToneContext = createSilentAudioContext();
      sineToneOscillator = sineToneContext.createOscillator();
      sineToneOscillator.type = 'sine';
      sineToneOscillator.frequency.setValueAtTime(440, sineToneContext.currentTime);

      sineToneGain = sineToneContext.createGain();
      sineToneGain.gain.setValueAtTime(0.2, sineToneContext.currentTime);

      sineToneDestination = sineToneContext.createMediaStreamDestination();
      sineToneOscillator.connect(sineToneGain);
      sineToneGain.connect(sineToneDestination);

      sineToneOscillator.start();
      sineToneStream = sineToneDestination.stream;
      debugLog('440Hz Sine tone generator started.');
      return sineToneStream;
    } catch (err) {
      console.error('Failed to start 440Hz sine tone generator:', err);
      return null;
    }
  }

  function stopSineToneGenerator() {
    if (sineToneOscillator) {
      try {
        sineToneOscillator.stop();
        sineToneOscillator.disconnect();
      } catch (e) {}
      sineToneOscillator = null;
    }
    if (sineToneGain) {
      try {
        sineToneGain.disconnect();
      } catch (e) {}
      sineToneGain = null;
    }
    if (sineToneContext && sineToneContext.state !== 'closed') {
      try {
        sineToneContext.close();
      } catch (e) {}
      sineToneContext = null;
    }
    sineToneDestination = null;
    sineToneStream = null;
    debugLog('440Hz Sine tone generator stopped.');
  }

  /**
   * Sets up a local WebRTC loopback connection between two RTCPeerConnection objects.
   * @param {MediaStream} stream The local audio stream to send through the connection.
   * @returns {Promise<MediaStream>} A promise that resolves with the remote stream.
   */
  async function setupPeerConnection(stream) {
    debugLog('Setting up PeerConnection.');
    pc1 = new RTCPeerConnection();
    pc2 = new RTCPeerConnection();

    const [localTrack] = stream.getAudioTracks();
    pc1.addTrack(localTrack, stream);

    const remoteStreamPromise = new Promise((resolve) => {
      pc2.ontrack = (event) => {
        debugLog('pc2 received remote track.');
        resolve(event.streams[0]);
      };
    });

    exchangeIceCandidates(pc1, pc2);

    pc1.oniceconnectionstatechange = () => debugLog(`pc1 ICE state: ${pc1.iceConnectionState}`);
    pc2.oniceconnectionstatechange = () => debugLog(`pc2 ICE state: ${pc2.iceConnectionState}`);

    try {
      const offer = await pc1.createOffer();
      debugLog('pc1 offer SDP:\n', offer.sdp);
      await pc1.setLocalDescription(offer);
      await pc2.setRemoteDescription(offer);

      const answer = await pc2.createAnswer();
      debugLog('pc2 original answer SDP:\n', answer.sdp);
      answer.sdp = insertStereoSupportForOpus(answer.sdp);
      if (dtxCheckbox.checked) {
        answer.sdp = insertDtxSupportForOpus(answer.sdp);
      }
      debugLog('pc2 modified answer SDP:\n', answer.sdp);
      await pc2.setLocalDescription(answer);
      await pc1.setRemoteDescription(answer);
      debugLog('PeerConnection offer-answer exchange complete.');
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
      debugLog('pc1 closed.');
    }
    if (pc2) {
      pc2.close();
      pc2 = null;
      debugLog('pc2 closed.');
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

  const peerConnectionLabel = document.querySelector('label[for="peerconnection-checkbox"]');
  const dtxLabel = document.querySelector('label[for="dtx-checkbox"]');
  const muteLabel = document.querySelector('label[for="mute-checkbox"]');
  const htmlPlayLabel = document.querySelector('label[for="html-play-checkbox"]');
  const webaudioPlayLabel = document.querySelector('label[for="webaudio-play-checkbox"]');

  function updateActionButtonsTooltips() {
    const isMic = micSourceRadio.checked;
    gumButton.textContent = isMic ? 'getUserMedia' : 'captureStream';
    if (gumButton.disabled) {
      gumButton.setAttribute('data-tooltip', isMic
        ? "Active stream running via getUserMedia(). Click 'Stop Stream' to stop before requesting a new stream."
        : "Active stream running via captureStream(). Click 'Stop Stream' to stop before starting a new stream.");
    } else {
      gumButton.setAttribute('data-tooltip', isMic
        ? 'Acquire a local audio MediaStream using the navigator.mediaDevices.getUserMedia() API and configured constraints.'
        : 'Play the selected audio file and capture it as a MediaStream with HTMLMediaElement.captureStream(). No microphone permission is needed.');
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

  function updateAutoPlayTooltip() {
    if (autoPlayLabel && autoPlayCheckbox) {
      const mode = autoPlayModeName();
      autoPlayLabel.setAttribute('data-tooltip', autoPlayCheckbox.checked
        ? `Auto-play is enabled. Audio track will automatically start playing in loopback via ${mode} as soon as the stream is acquired.`
        : `Automatically start rendering the audio track in loopback using ${mode} as soon as the stream is acquired.`);
    }
    syncAutoPlayMode();
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
        : 'Route audio through Web Audio API (AudioContext & MediaStreamAudioSourceNode) applying latencyHint, sampleRate, and renderSizeHint.');
    }
  }

  peerConnectionCheckbox.addEventListener('change', () => {
    updatePeerConnectionTooltip();
    if (peerConnectionCheckbox.checked) {
      debugLog('PeerConnection enabled');
    } else {
      debugLog('PeerConnection disabled');
    }
  });

  dtxCheckbox.addEventListener('change', () => {
    updateDtxTooltip();
    if (dtxCheckbox.checked) {
      debugLog('VAD/DTX/CNG enabled');
    } else {
      debugLog('VAD/DTX/CNG disabled');
    }
  });

  if (autoRecordCheckbox) {
    autoRecordCheckbox.addEventListener('change', () => {
      updateAutoRecordTooltip();
      if (autoRecordCheckbox.checked) {
        debugLog('Auto-record enabled');
        logLifecycleEvent('Auto-Record', 'Auto-Record enabled (will capture audio at time zero)');
      } else {
        debugLog('Auto-record disabled');
        logLifecycleEvent('Auto-Record', 'Auto-Record disabled');
      }
    });
  }

  if (autoPlayCheckbox) {
    autoPlayCheckbox.addEventListener('change', () => {
      updateAutoPlayTooltip();
      if (autoPlayCheckbox.checked) {
        debugLog('Auto-play enabled');
        logLifecycleEvent('Auto-Play', `Auto-Play enabled (will start ${autoPlayModeName()} from start)`);
      } else {
        debugLog('Auto-play disabled');
        logLifecycleEvent('Auto-Play', 'Auto-Play disabled');
      }
    });
  }
  if (autoPlayModeSelect) {
    autoPlayModeSelect.addEventListener('change', () => {
      updateAutoPlayTooltip();
      logLifecycleEvent('Auto-Play', `Auto-Play mode: ${autoPlayModeName()}`);
    });
  }

  // Set the initial tooltip state on page load.
  updateActionButtonsTooltips();
  updatePeerConnectionTooltip();
  updateDtxTooltip();
  updateAutoRecordTooltip();
  updateAutoPlayTooltip();
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
    fileSelectionContainer.hidden = isMic;
    // Button text and tooltip: getUserMedia or captureStream.
    updateActionButtonsTooltips();

    if (!isMic) {
      constraintSelects.forEach(select => {
        select.disabled = true;
        select.parentElement.classList.add('disabled-setting');
      });
      constraintsPreElements.forEach(pre => pre.classList.add('disabled-setting'));
      document.querySelector('.dynamic-constraints-group')?.classList.add('disabled-setting');
      applyConstraintsButton.disabled = true;
      if (sineToneCheckbox) {
        sineToneCheckbox.disabled = true;
        sineToneCheckbox.parentElement.classList.add('disabled-setting');
      }
    } else {
      constraintsPreElements.forEach(pre => pre.classList.remove('disabled-setting'));
      document.querySelector('.dynamic-constraints-group')?.classList.remove('disabled-setting');
      if (sineToneCheckbox && !sineToneCheckbox.dataset.locked) {
        sineToneCheckbox.disabled = false;
        sineToneCheckbox.parentElement.classList.remove('disabled-setting');
      }
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

    if (params.get('autoPlayMode') === 'webaudio' && autoPlayModeSelect) {
      autoPlayModeSelect.value = 'webaudio';
    }
    if (params.has('autoPlay') && params.get('autoPlay') === 'true' && autoPlayCheckbox) {
      autoPlayCheckbox.checked = true;
      autoPlayCheckbox.dispatchEvent(new Event('change'));
    }

    if (params.has('sineTone') && params.get('sineTone') === 'true' && sineToneCheckbox) {
      sineToneCheckbox.checked = true;
      sineToneCheckbox.dispatchEvent(new Event('change'));
    }

    debugLog(`applyUrlParameters: echoCancellation from URL is "${params.get('echoCancellation')}"`);
    debugLog(`applyUrlParameters: autoGainControl from URL is "${params.get('autoGainControl')}"`);
    debugLog(`applyUrlParameters: noiseSuppression from URL is "${params.get('noiseSuppression')}"`);
    if (isVoiceIsolationSupported) {
      debugLog(`applyUrlParameters: voiceIsolation from URL is "${params.get('voiceIsolation')}"`);
    }
    debugLog(`applyUrlParameters: channelCount from URL is "${params.get('channelCount')}"`);
    debugLog(`applyUrlParameters: latency from URL is "${params.get('latency')}"`);
    debugLog(`applyUrlParameters: sampleRate from URL is "${params.get('sampleRate')}"`);
    debugLog(`applyUrlParameters: sampleSize from URL is "${params.get('sampleSize')}"`);
    debugLog(`applyUrlParameters: deviceId from URL is "${params.get('deviceId')}"`);
  }

  function setConstraintsDisabled(disabled) {
    constraintSelects.forEach(select => {
      select.disabled = disabled;
    });
    micSourceRadio.disabled = disabled;
    fileSourceRadio.disabled = disabled;
    audioFileSelect.disabled = disabled;
    localFileInput.disabled = disabled;
    if (sineToneCheckbox) {
      if (disabled) {
        sineToneCheckbox.dataset.locked = 'true';
        sineToneCheckbox.disabled = true;
      } else {
        delete sineToneCheckbox.dataset.locked;
        sineToneCheckbox.disabled = !micSourceRadio.checked;
      }
    }

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
      recordButton.setAttribute('data-tooltip', 'Record the audio stream to an Opus WebM blob using the MediaRecorder API. If 440Hz Sine is on when recording starts, the tone is recorded; otherwise the microphone (or audio file). Switching the tone during a recording does not change the recorded source.');
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
        debugLog(`Using supported mimeType: ${mimeType}`);
        return mimeType;
      }
    }
    console.warn('No preferred mimeType supported. Using default.');
    return ''; // Let the browser decide
  }

  async function populateAudioInputDevices() {
    debugLog('Populating audio input devices...');
    
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
        errorMessageElement.hidden = false;
        return;
      }
    }

    const selectedDeviceId = audioDeviceSelect.value;
    debugLog(`populateAudioInputDevices: selectedDeviceId before populating is "${selectedDeviceId}"`);
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
    debugLog(`populateAudioInputDevices: selectedDeviceId after populating is "${audioDeviceSelect.value}"`);
  }

  async function populateAudioOutputDevices() {
    if (!('setSinkId' in HTMLMediaElement.prototype)) {
      audioOutputDeviceSelect.disabled = true;
      audioOutputDeviceSelect.title = 'Audio output device selection is not supported by this browser.';
      return;
    }
    debugLog('Populating audio output devices...');
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selectedDeviceId = audioOutputDeviceSelect.value;
    debugLog(`populateAudioOutputDevices: selectedDeviceId before populating is "${selectedDeviceId}"`);
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
    debugLog(`populateAudioOutputDevices: selectedDeviceId after populating is "${audioOutputDeviceSelect.value}"`);
  }

  function updateVisualizerRmsLabel() {
    if (peerConnectionCheckbox.checked && rmsAudioLevels.length > 0) {
      showAudioLevelLabel(latestRmsAudioLevel);
    } else {
      hideAudioLevelLabel();
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
    debugLog('MediaStreamTrack properties:', currentProperties);
    snapshotState.trackProperties = currentProperties;

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
      const textContent = escapeHtml(`"${key}": ${valueStr}${isLast ? '' : ','}`);
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

  const TRACK_ROW_TAIL_KEYS = ['deviceId', 'groupId'];

  /**
   * Returns the shared row order for the getConstraints() and getSettings()
   * panes: the sorted union of keys, with deviceId and groupId last. The
   * constraints side is only included in mic mode (where it is shown).
   * @param {MediaStreamTrack} audioTrack
   * @returns {string[]}
   */
  function trackRowKeys(audioTrack) {
    const constraints = (micSourceRadio.checked && audioTrack.getConstraints) ? audioTrack.getConstraints() : {};
    const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
    const all = new Set([...Object.keys(constraints), ...Object.keys(settings)]);
    const head = [...all].filter(k => !TRACK_ROW_TAIL_KEYS.includes(k)).sort();
    const tail = TRACK_ROW_TAIL_KEYS.filter(k => all.has(k));
    return [...head, ...tail];
  }

  /** Formats a value as one-line JSON, e.g. { "exact": true }. */
  function formatInlineValue(value) {
    if (Array.isArray(value)) {
      return `[${value.map(formatInlineValue).join(', ')}]`;
    }
    if (value && typeof value === 'object') {
      const parts = Object.entries(value).map(([k, v]) => `${JSON.stringify(k)}: ${formatInlineValue(v)}`);
      return parts.length ? `{ ${parts.join(', ')} }` : '{}';
    }
    return JSON.stringify(value);
  }

  /**
   * Renders obj as JSON-like text with one row per key in rowKeys. Keys that
   * obj lacks become blank rows so that two panes line up. Blank rows after
   * the last real entry are dropped.
   * @param {Object} obj
   * @param {string[]} rowKeys
   * @param {(key: string, escapedText: string) => string} wrap - Adds highlight markup.
   * @returns {string} HTML
   */
  function renderAlignedRows(obj, rowKeys, wrap) {
    const has = k => Object.prototype.hasOwnProperty.call(obj, k);
    let lastReal = -1;
    rowKeys.forEach((k, i) => { if (has(k)) lastReal = i; });
    if (lastReal < 0) return '{}';
    const lines = rowKeys.slice(0, lastReal + 1).map((key, i) => {
      if (!has(key)) return '';
      const text = escapeHtml(`"${key}": ${formatInlineValue(obj[key])}${i === lastReal ? '' : ','}`);
      return '  ' + wrap(key, text);
    });
    return `{\n${lines.join('\n')}\n}`;
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
      snapshotState.trackConstraints = null;
      trackConstraintsElement.innerHTML = '';
      trackConstraintsElement.hidden = true;
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
    snapshotState.trackConstraints = displayConstraints;

    const header = 'getConstraints():\n';
    const content = renderAlignedRows(displayConstraints, trackRowKeys(audioTrack), (key, text) =>
      highlightedKeys.includes(key) ? `<span class="highlight">${text}</span>` : text);
    trackConstraintsElement.innerHTML = header + content;
    trackConstraintsElement.hidden = false;

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
      snapshotState.trackSettings = null;
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
    snapshotState.trackSettings = displaySettings;

    const header = 'getSettings():\n';
    const content = renderAlignedRows(displaySettings, trackRowKeys(audioTrack), (key, text) => {
      const status = statusMap[key];
      if (status === 'applied') return `<span class="highlight-green">${text}</span>`;
      if (status === 'not-applied') return `<span class="highlight-red">${text}</span>`;
      return text;
    });
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
      snapshotState.trackStats = null;
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

      snapshotState.trackStats = extendedStats;
      trackStatsElement.textContent = 'stats:\n' + JSON.stringify(extendedStats, null, 2);

      // Update previousStats for the next call, storing only the necessary fields.
      previousStats = {
        deliveredFrames: currentStats.deliveredFrames,
        totalFrames: currentStats.totalFrames,
        droppedFrames: extendedStats.droppedFrames,
      };
    } else {
      snapshotState.trackStats = 'Not supported';
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
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.hidden = true;
      outboundRtpStatsElement.hidden = true;
      inboundRtpStatsElement.hidden = true;
      audioPlayoutStatsElement.hidden = true;
      return;
    }

    try {
      const report = await pc1.getStats();
      let outboundStatsFound = false;
      for (const stats of report.values()) {
        if (stats.type === 'outbound-rtp') {
          outboundStatsFound = true;
          const displayStats = {};

          if (stats.kind !== undefined) {
            displayStats.kind = stats.kind;
          }
          if (stats.ssrc !== undefined) {
            displayStats.ssrc = stats.ssrc;
          }
          displayStats.packetsSent = stats.packetsSent;
          displayStats.bytesSent = stats.bytesSent;
          if (stats.retransmittedPacketsSent !== undefined) {
            displayStats.retransmittedPacketsSent = stats.retransmittedPacketsSent;
          }
          if (stats.retransmittedBytesSent !== undefined) {
            displayStats.retransmittedBytesSent = stats.retransmittedBytesSent;
          }
          if (stats.targetBitrate !== undefined) {
            displayStats.targetBitrate = stats.targetBitrate;
          }
          if (stats.totalPacketSendDelay !== undefined) {
            displayStats.totalPacketSendDelay = parseFloat(stats.totalPacketSendDelay.toFixed(3));
          }
          if (stats.totalSamplesSent !== undefined) {
            displayStats.totalSamplesSent = stats.totalSamplesSent;
          }
          if (stats.powerEfficientEncoder !== undefined) {
            displayStats.powerEfficientEncoder = stats.powerEfficientEncoder;
          }
          if (stats.encoderImplementation) {
            displayStats.encoderImplementation = stats.encoderImplementation;
          }
          if (stats.trackIdentifier) {
            displayStats.trackIdentifier = stats.trackIdentifier.length > 8 ?
                `${stats.trackIdentifier.substring(0, 8)}..` : stats.trackIdentifier;
          }
          if (stats.codecId) {
            const codec = report.get(stats.codecId);
            if (codec) {
              displayStats.codec = codec.mimeType.split('/')[1];
              displayStats.channels = codec.channels;
            }
          }

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

          snapshotState.outboundRtp = displayStats;
          snapshotState.inboundRtp = null;
          snapshotState.audioPlayout = null;
          outboundRtpStatsElement.textContent = 'outbound-rtp (pc1):\n' + JSON.stringify(displayStats, null, 2);
          inboundRtpStatsElement.textContent = 'inbound-rtp (pc2):\n';
          audioPlayoutStatsElement.textContent = 'audio-playout (pc2):\n';
        }
      }
      // Show or hide the element based on whether stats were found in this report.
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.hidden = !outboundStatsFound;
      outboundRtpStatsElement.hidden = !outboundStatsFound;
      inboundRtpStatsElement.hidden = !outboundStatsFound;
      audioPlayoutStatsElement.hidden = !outboundStatsFound;
    } catch (err) {
      console.error('Error getting RTP stats:', err);
      if (rtpStatsSectionContainer) rtpStatsSectionContainer.hidden = true;
      outboundRtpStatsElement.hidden = true;
      inboundRtpStatsElement.hidden = true;
      audioPlayoutStatsElement.hidden = true;
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

            if (stats.kind !== undefined) {
              displayStats.kind = stats.kind;
            }
            if (stats.ssrc !== undefined) {
              displayStats.ssrc = stats.ssrc;
            }
            if (stats.packetsReceived !== undefined) {
              displayStats.packetsReceived = stats.packetsReceived;
            }
            if (stats.packetsLost !== undefined) {
              displayStats.packetsLost = stats.packetsLost;
            }
            if (stats.jitter !== undefined) {
              displayStats.jitter = parseFloat(stats.jitter.toFixed(4));
            }
            if (stats.packetsDiscarded !== undefined) {
              displayStats.packetsDiscarded = stats.packetsDiscarded;
            }
            if (stats.concealedSamples !== undefined) {
              displayStats.concealedSamples = stats.concealedSamples;
            }
            if (stats.silentConcealedSamples !== undefined) {
              displayStats.silentConcealedSamples = stats.silentConcealedSamples;
            }
            if (stats.audioLevel !== undefined) {
              displayStats.audioLevel = parseFloat(stats.audioLevel.toFixed(2));
            }
            if (stats.totalAudioEnergy !== undefined) {
              displayStats.totalAudioEnergy = parseFloat(stats.totalAudioEnergy.toFixed(1));
            }
            if (stats.totalSamplesReceived !== undefined) {
              displayStats.totalSamplesReceived = stats.totalSamplesReceived;
            }
            if (stats.totalSamplesDuration !== undefined) {
              displayStats.totalSamplesDuration = parseFloat(stats.totalSamplesDuration.toFixed(1));
            }
            if (stats.jitterBufferDelay !== undefined) {
              displayStats.jitterBufferDelay = parseFloat(stats.jitterBufferDelay.toFixed(3));
            }
            if (stats.jitterBufferEmittedCount !== undefined) {
              displayStats.jitterBufferEmittedCount = stats.jitterBufferEmittedCount;
            }
            if (stats.jitterBufferTargetDelay !== undefined) {
              displayStats.jitterBufferTargetDelay = parseFloat(stats.jitterBufferTargetDelay.toFixed(3));
            }
            if (stats.totalProcessingDelay !== undefined) {
              displayStats.totalProcessingDelay = parseFloat(stats.totalProcessingDelay.toFixed(3));
            }
            if (stats.playoutId) {
              displayStats.playoutId = stats.playoutId;
            }
            if (stats.trackIdentifier) {
              displayStats.trackIdentifier = stats.trackIdentifier.length > 8 ?
                  `${stats.trackIdentifier.substring(0, 8)}..` : stats.trackIdentifier;
            }

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
                  updateVisualizerRmsLabel();
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
            snapshotState.inboundRtp = displayStats;
            inboundRtpStatsElement.textContent = 'inbound-rtp (pc2):\n' + JSON.stringify(displayStats, null, 2);
          }
          if (stats.type === 'media-playout') {
            playoutStatsFound = true;
            const displayStats = {};

            let simEventsDelta = 0;
            let simDurationDelta = 0;
            if (simulatedGlitchMode === 'minor') {
              simEventsDelta = 1;
              simDurationDelta = 0.010;
              setSimulatedGlitchMode('none');
            } else if (simulatedGlitchMode === 'degraded') {
              simEventsDelta = 2;
              simDurationDelta = 0.020;
            }

            if (simEventsDelta > 0 || simDurationDelta > 0) {
              simulatedGlitchCumulativeEvents += simEventsDelta;
              simulatedGlitchCumulativeDuration += simDurationDelta;
            }

            const currentSynthesizedEvents = stats.synthesizedSamplesEvents + simulatedGlitchCumulativeEvents;
            const currentSynthesizedDuration = parseFloat((stats.synthesizedSamplesDuration + simulatedGlitchCumulativeDuration).toFixed(3));

            if (stats.kind !== undefined) {
              displayStats.kind = stats.kind;
            }
            displayStats.synthesizedSamplesDuration = currentSynthesizedDuration;
            displayStats.synthesizedSamplesEvents = currentSynthesizedEvents;
            displayStats.totalSamplesDuration = parseFloat(stats.totalSamplesDuration.toFixed(1));
            displayStats.totalPlayoutDelay = parseFloat(stats.totalPlayoutDelay.toFixed(3));
            displayStats.totalSamplesCount = stats.totalSamplesCount;

            let intervalHasGlitch = false;
            // Calculate and add interval-specific rates.
            if (previousPlayoutStats) {
              const deltaSynthesizedSamplesDuration = currentSynthesizedDuration - previousPlayoutStats.synthesizedSamplesDuration;
              const deltaTotalSamplesDuration = stats.totalSamplesDuration - previousPlayoutStats.totalSamplesDuration;
              const deltaTotalPlayoutDelay = stats.totalPlayoutDelay - previousPlayoutStats.totalPlayoutDelay;
              const deltaTotalSamplesCount = stats.totalSamplesCount - previousPlayoutStats.totalSamplesCount;
              const deltaSynthesizedSamplesEvents = currentSynthesizedEvents - previousPlayoutStats.synthesizedSamplesEvents;

              const rate = {};
              rate.synthesizedSamplesDuration = parseFloat(deltaSynthesizedSamplesDuration.toFixed(3));
              rate.synthesizedSamplesEvents = deltaSynthesizedSamplesEvents;
              const synthesizedSamplesPercentage = (deltaTotalSamplesDuration > 0) ? (deltaSynthesizedSamplesDuration / deltaTotalSamplesDuration) * 100 : 0;
              rate.synthesizedSamplesPercentage = parseFloat(synthesizedSamplesPercentage.toFixed(1));
              const averagePlayoutDelayMs = (deltaTotalSamplesCount > 0) ? (deltaTotalPlayoutDelay / deltaTotalSamplesCount) * 1000 : 0;
              rate.averagePlayoutDelayMs = parseFloat(averagePlayoutDelayMs.toFixed(1));
              displayStats.rate = rate;

              if (deltaSynthesizedSamplesDuration > 0 || deltaSynthesizedSamplesEvents > 0) {
                glitchy_intervals++;
                intervalHasGlitch = true;
              }

              glitchWindow.push(intervalHasGlitch);
              if (glitchWindow.length > GLITCH_WINDOW_SIZE) {
                glitchWindow.shift();
              }
            }

            total_intervals++;
            let ratio = 0;
            if (total_intervals > 0) {
              ratio = glitchy_intervals / total_intervals;
            }
            const glitchRatio = ratio === 0 ? 0 : parseFloat(ratio.toFixed(5));

            const recentGlitchCount = glitchWindow.filter(Boolean).length;
            const recentGlitchRatio = glitchWindow.length > 0 ? parseFloat((recentGlitchCount / glitchWindow.length).toFixed(2)) : 0;

            const summary = {
              recentGlitchRatio: recentGlitchRatio,
              glitchyIntervals: glitchy_intervals,
              totalIntervals: total_intervals,
              glitchRatio: glitchRatio,
            };

            if (stats.totalSamplesCount > 0) {
              const averagePlayoutDelayMs = (stats.totalPlayoutDelay / stats.totalSamplesCount) * 1000;
              summary.averagePlayoutDelayMs = parseFloat(averagePlayoutDelayMs.toFixed(1));
            }
            if (stats.totalSamplesDuration > 0) {
              const averageSynthesizedPercentage = (currentSynthesizedDuration / stats.totalSamplesDuration) * 100;
              summary.averageSynthesizedPercentage = parseFloat(averageSynthesizedPercentage.toFixed(1));
            }
            displayStats.summary = summary;

            // Update previousPlayoutStats for the next interval.
            previousPlayoutStats = {
              synthesizedSamplesEvents: currentSynthesizedEvents,
              synthesizedSamplesDuration: currentSynthesizedDuration,
              totalSamplesDuration: stats.totalSamplesDuration,
              totalPlayoutDelay: stats.totalPlayoutDelay,
              totalSamplesCount: stats.totalSamplesCount,
            };

            if (intervalHasGlitch) {
              audioPlayoutStatsElement.classList.add('glitch-active');
            } else {
              audioPlayoutStatsElement.classList.remove('glitch-active');
            }

            let badgeHtml = '<span class="glitch-badge glitch-badge-clean">Clean</span>';
            if (recentGlitchCount >= 2) {
              badgeHtml = `<span class="glitch-badge glitch-badge-error">Degraded (${recentGlitchCount} in ${glitchWindow.length}s)</span>`;
            } else if (recentGlitchCount === 1) {
              badgeHtml = `<span class="glitch-badge glitch-badge-warning">Minor (1 in ${glitchWindow.length}s)</span>`;
            }

            let statsString = JSON.stringify(displayStats, null, 2);
            if (displayStats.rate && displayStats.rate.synthesizedSamplesEvents > 0) {
              statsString = statsString.replace(
                /"synthesizedSamplesEvents": (\d+)/,
                '"synthesizedSamplesEvents": <span class="stat-alert">$1</span>'
              );
            }
            snapshotState.audioPlayout = displayStats;
            audioPlayoutStatsElement.innerHTML = `audio-playout (pc2): ${badgeHtml}\n` + statsString;
          }
        }
        if (!playoutStatsFound) {
          snapshotState.audioPlayout = null;
          audioPlayoutStatsElement.classList.remove('glitch-active');
          audioPlayoutStatsElement.textContent = 'audio-playout (pc2):\n';
        }
        if (!inboundRtpStatsFound) {
          snapshotState.inboundRtp = null;
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
    debugLog('Selected echoCancellation value:', echoCancellation);
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
    if (autoPlayCheckbox) {
      autoPlayCheckbox.disabled = true;
      syncAutoPlayMode();
    }
    setConstraintsDisabled(true);
    previousStats = null;
    previousTrackProperties = null;
    previousOutboundRtpStats = null;
    previousInboundRtpStats = null;
    previousPlayoutStats = null;
    total_intervals = 0;
    glitchy_intervals = 0;
    glitchWindow.length = 0;
    simulatedGlitchCumulativeEvents = 0;
    simulatedGlitchCumulativeDuration = 0;
    updateVisualizerRmsLabel();
    errorMessageElement.textContent = '';
    errorMessageElement.hidden = true;
    bookmarkUrlContainer.innerHTML = ''; // Clear the bookmark URL
    // Reset to default error colors from CSS
    errorMessageElement.classList.remove('notice');
    const audioConstraints = buildAudioConstraints();
    const deviceId = audioDeviceSelect.value;
    if (deviceId !== 'undefined') {
      audioConstraints.deviceId = { exact: deviceId };
    }
    const constraints = {
      audio: Object.keys(audioConstraints).length === 0 ? true : audioConstraints,
      video: false
    };
    debugLog('--- getUserMedia() START ---');
    debugLog('Supplied constraints to getUserMedia():', JSON.stringify(constraints, null, 2));

    try {
      let stream;
      if (micSourceRadio.checked) {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        debugLog('navigator.mediaDevices.getUserMedia() succeeded.');
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
        debugLog('audioElement.captureStream() successful');
      }
      
      localStream = stream;

      let streamToSendAndPlay = localStream;
      if (micSourceRadio.checked && sineToneCheckbox && sineToneCheckbox.checked) {
        const toneStream = startSineToneGenerator();
        if (toneStream) {
          streamToSendAndPlay = toneStream;
          debugLog('Replacing live mic stream with 440Hz sine tone for loopback/playback while keeping mic capture active.');
        }
      }

      // Start recording immediately at time zero if Auto-Record is enabled.
      // Runs after the sine tone setup so the recorder picks the right source.
      if (autoRecordCheckbox && autoRecordCheckbox.checked) {
        startRecording(true);
      }

      streamForPlaybackAndVisualizer = streamToSendAndPlay;
      if (peerConnectionCheckbox.checked) {
        try {
          const remoteStream = await setupPeerConnection(streamToSendAndPlay);
          debugLog('PeerConnection loopback established successfully.');
          streamForPlaybackAndVisualizer = remoteStream;
        } catch (err) {
          console.error('PeerConnection setup failed:', err);
          errorMessageElement.textContent = `PC Error: ${err.name} - ${err.message}`;
          errorMessageElement.hidden = false;
          logLifecycleEvent('PeerConnection Error', `${err.name}: ${err.message}`, 'error');
          // Don't proceed with a broken stream setup
          return;
        }
      }

      const [audioTrack] = stream.getAudioTracks();
      debugLog('Created audioTrack:', audioTrack.label, `(id: ${audioTrack.id}, readyState: ${audioTrack.readyState})`);
      debugLog('audioTrack.getConstraints() returns:', audioTrack.getConstraints ? audioTrack.getConstraints() : 'N/A');
      debugLog('audioTrack.getSettings() returns:', audioTrack.getSettings());
      debugLog('--- getUserMedia() END ---');
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
        debugLog('Audio track muted:', event);
        logLifecycleEvent('track.onmute', `Warning: Audio track muted - ${event.type}`, 'warning');
        errorMessageElement.textContent = `Warning: Audio track muted - ${event.type}`;
        errorMessageElement.hidden = false;
        errorMessageElement.classList.add('notice');
        updateTrackProperties(audioTrack);
      };
      audioTrack.onunmute = (event) => {
        debugLog('Audio track unmuted:', event);
        logLifecycleEvent('track.onunmute', 'Audio track unmuted - capture resumed', 'success');
        errorMessageElement.textContent = '';
        errorMessageElement.hidden = true;
        // Reset to default error colors from CSS
        errorMessageElement.classList.remove('notice');
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
            debugLog('rmsAudioLevels (trimmed) = ' + JSON.stringify(trimmedLevels));
            
            // 1. Calculate True RMS for the complete duration
            const totalSumOfSquares = trimmedLevels.reduce((sum, level) => sum + level * level, 0);
            const totalTrueRms = Math.sqrt(totalSumOfSquares / trimmedLevels.length);
            debugLog('Total True RMS audio level = ' + totalTrueRms.toFixed(5));

            // 2. Calculate True RMS per 10-second interval
            debugLog('10-second Interval True RMS values:');
            for (let i = 0; i < trimmedLevels.length; i += 10) {
              const chunk = trimmedLevels.slice(i, i + 10);
              const chunkSumOfSquares = chunk.reduce((sum, level) => sum + level * level, 0);
              const chunkRms = Math.sqrt(chunkSumOfSquares / chunk.length);
              
              // This is the exact value the DataPointAggregator will output for this interval
              debugLog(`  Interval ${Math.floor(i/10) + 1} (${chunk.length}s): ${chunkRms.toFixed(5)}`);
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
        errorMessageElement.hidden = false;
      };
      stopButton.disabled = false;
      recordButton.disabled = false;
      streamControlsContainer.hidden = false;
      audioDevicesContainer.hidden = false;
      snapshotButtonContainer.hidden = false;
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
        renderMicSourceInfo(selectedDevice, sineToneCheckbox && sineToneCheckbox.checked);
      } else if (!micSourceRadio.checked) {
        const filename = (currentFileSourceType === 'predefined') ? audioFileSelect.value : (localFileName || 'Local File');
        const duration = fileSourceAudio.duration ? fileSourceAudio.duration.toFixed(2) + 's' : 'Unknown';
        const loop = fileSourceAudio.loop;
        const playbackRate = fileSourceAudio.playbackRate;

        const fileSourceInfo = {
          type: 'Audio File',
          label: filename,
          duration,
          loop: String(loop),
          playbackRate: String(playbackRate),
          sampleRate: 'Loading...',
          channels: 'Loading...',
        };
        snapshotState.audioSource = fileSourceInfo;

        audioInputDeviceElement.innerHTML = `Active audio source:\n` +
            `  type: Audio File\n` +
            `  label: ${escapeHtml(filename)}\n` +
            `  duration: ${duration}\n` +
            `  loop: ${loop}\n` +
            `  playbackRate: ${playbackRate}\n` +
            `  sampleRate: <span id="info-samplerate">Loading...</span>\n` +
            `  channels: <span id="info-channels">Loading...</span>\n` +
            `<span id="info-extra-wav"></span>` +
            `<span id="audio-file-time">time: 0.00s / ${duration}</span>` +
            `<progress id="audio-file-progress" value="0" max="100"></progress>`;
        audioInputDeviceElement.hidden = false;
        updateAudioFileProgress();

        // Fetch and update metadata
        getAudioFileMetadata(fileSourceAudio.src).then(metadata => {
            const sampleRateEl = document.getElementById('info-samplerate');
            const channelsEl = document.getElementById('info-channels');
            const extraEl = document.getElementById('info-extra-wav');
            
            if (metadata) {
                if (sampleRateEl) sampleRateEl.textContent = metadata.sampleRate;
                if (channelsEl) channelsEl.textContent = metadata.numberOfChannels;
                fileSourceInfo.sampleRate = String(metadata.sampleRate);
                fileSourceInfo.channels = String(metadata.numberOfChannels);

                // Only show extra details if they were parsed (typically from WAV header)
                if (metadata.audioFormat && extraEl) {
                    extraEl.textContent = `  sampleSize: ${metadata.bitsPerSample}\n` +
                                          `  format: ${metadata.audioFormat}\n` +
                                          `  byteRate: ${metadata.byteRate}\n` +
                                          `  blockAlign: ${metadata.blockAlign}\n`;
                    fileSourceInfo.sampleSize = String(metadata.bitsPerSample);
                    fileSourceInfo.format = String(metadata.audioFormat);
                    fileSourceInfo.byteRate = String(metadata.byteRate);
                    fileSourceInfo.blockAlign = String(metadata.blockAlign);
                }
            } else {
                if (sampleRateEl) sampleRateEl.textContent = 'Unknown';
                if (channelsEl) channelsEl.textContent = 'Unknown';
                fileSourceInfo.sampleRate = 'Unknown';
                fileSourceInfo.channels = 'Unknown';
            }
        });

      } else {
        snapshotState.audioSource = null;
        audioInputDeviceElement.hidden = true;
      }

      audioPlayback.srcObject = streamForPlaybackAndVisualizer;
      if (autoPlayCheckbox && autoPlayCheckbox.checked) {
        const target = autoPlayModeName() === 'WebAudio:Play' ? webaudioPlayCheckbox : htmlPlayCheckbox;
        if (target !== htmlPlayCheckbox) htmlPlayCheckbox.checked = false;
        target.checked = true;
        target.dispatchEvent(new Event('change'));
      } else {
        htmlPlayCheckbox.checked = false;
      }
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
      errorMessageElement.hidden = false;
      logLifecycleEvent(micSourceRadio.checked ? 'getUserMedia Error' : 'captureStream Error', errorMsg, 'error');
      gumButton.disabled = false;
      applyConstraintsButton.disabled = true;
      copyBookmarkButton.disabled = false;
      peerConnectionCheckbox.disabled = false;
      dtxCheckbox.disabled = false;
      if (autoRecordCheckbox) {
        autoRecordCheckbox.disabled = false;
      }
      if (autoPlayCheckbox) {
        autoPlayCheckbox.disabled = false;
        syncAutoPlayMode();
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
    debugLog('--- applyConstraints() START ---');
    debugLog('Target track:', audioTrack.label, `(id: ${audioTrack.id}, readyState: ${audioTrack.readyState})`);
    debugLog('Before applyConstraints -> audioTrack.getConstraints() was:', audioTrack.getConstraints());
    debugLog('Before applyConstraints -> audioTrack.getSettings() was:', audioTrack.getSettings());
    debugLog('Supplied constraints payload to applyConstraints():', JSON.stringify(audioConstraints, null, 2));

    try {
      // Call standard MediaStreamTrack.applyConstraints().
      // Note: In Chromium, applyConstraints() resolves and updates track.getConstraints(),
      // but Chrome's underlying audio capture pipeline (MediaStreamAudioProcessor) does not
      // dynamically reconfigure WebRTC APM filters (AEC/AGC/NS) on an active capture stream.
      // Consequently, track.getSettings() reflects the active pipeline settings (which remain
      // unchanged), while track.getConstraints() reflects the newly requested constraint dictionary.
      await audioTrack.applyConstraints(audioConstraints);
      debugLog('audioTrack.applyConstraints() promise resolved successfully.');
      debugLog('After applyConstraints -> audioTrack.getConstraints() now returns:', audioTrack.getConstraints());
      debugLog('After applyConstraints -> audioTrack.getSettings() now returns:', audioTrack.getSettings());
      debugLog('--- applyConstraints() END ---');

      errorMessageElement.textContent = '';
      errorMessageElement.hidden = true;

      // Reset to default error colors from CSS
      errorMessageElement.classList.remove('notice');

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
      debugLog('--- applyConstraints() FAILED ---');
      let errorMsg = '';
      if (err.name === 'OverconstrainedError' && err.constraint) {
        errorMsg = `applyConstraints OverconstrainedError: constraint "${err.constraint}"`;
      } else if (err.message) {
        errorMsg = `applyConstraints Error: ${err.name} - ${err.message}`;
      } else {
        errorMsg = `applyConstraints Error: ${err.name}`;
      }
      errorMessageElement.textContent = errorMsg;
      errorMessageElement.hidden = false;
      logLifecycleEvent('applyConstraints Error', errorMsg, 'error');
    }
  });

  /**
   * Renders the 'Active audio source' box for a microphone and stores the same
   * data in snapshotState for the snapshot export.
   * @param {MediaDeviceInfo} device The active audio input device.
   * @param {boolean} toneOn True when the 440 Hz sine tone replaces the mic audio.
   */
  function renderMicSourceInfo(device, toneOn) {
    const info = { type: 'Microphone' };
    if (toneOn) {
      info.tone = '440 Hz Sine Wave (mic open)';
    }
    info.kind = device.kind;
    info.label = device.label;
    info.deviceId = device.deviceId;
    info.groupId = device.groupId;
    snapshotState.audioSource = info;

    const toneInfo = toneOn ? `\n  tone: ${info.tone}` : '';
    audioInputDeviceElement.textContent = `Active audio source:\n` +
        `  type: Microphone${toneInfo}\n` +
        `  kind: ${device.kind}\n` +
        `  label: ${device.label}\n` +
        `  deviceId: ${device.deviceId}\n` +
        `  groupId: ${device.groupId}`;
    audioInputDeviceElement.hidden = false;
  }

  /**
   * Displays information about the active audio output device.
   * This function finds the full device details from the enumerated device list
   * using the provided sinkId. This ensures the displayed information accurately
   * reflects the device in use.
   * @param {string} sinkId The sinkId of the audio output device.
   */
  async function updateAudioOutputInfo(sinkId) {
    snapshotState.audioOutput = null;
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
        snapshotState.audioOutput = {
          kind: outputDevice.kind,
          label: outputDevice.label,
          deviceId: outputDevice.deviceId,
          groupId: outputDevice.groupId,
        };
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
    stopSineToneGenerator();
    latestRmsAudioLevel = null;
    stopVisualizer();
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
        debugLog('rmsAudioLevels (trimmed) = ' + JSON.stringify(trimmedLevels));
        
        // 1. Calculate True RMS for the complete duration
        const totalSumOfSquares = trimmedLevels.reduce((sum, level) => sum + level * level, 0);
        const totalTrueRms = Math.sqrt(totalSumOfSquares / trimmedLevels.length);
        debugLog('Total True RMS audio level = ' + totalTrueRms.toFixed(5));

        // 2. Calculate True RMS per 10-second interval
        debugLog('10-second Interval True RMS values:');
        for (let i = 0; i < trimmedLevels.length; i += 10) {
          const chunk = trimmedLevels.slice(i, i + 10);
          const chunkSumOfSquares = chunk.reduce((sum, level) => sum + level * level, 0);
          const chunkRms = Math.sqrt(chunkSumOfSquares / chunk.length);
          
          // This is the exact value the DataPointAggregator will output for this interval
          debugLog(`  Interval ${Math.floor(i/10) + 1} (${chunk.length}s): ${chunkRms.toFixed(5)}`);
        }
      }
    }
    clearInterval(statsInterval);
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    cancelAnimationFrame(fileProgressFrameRequest);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.hidden = true;
    audioDevicesContainer.hidden = true;
    snapshotButtonContainer.hidden = true;
    audioOutputInfoElement.hidden = true;
    audioOutputInfoElement.textContent = '';
    if (webaudioContextInfoElement) {
      webaudioContextInfoElement.hidden = true;
      webaudioContextInfoElement.textContent = '';
    }
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
    if (autoPlayCheckbox) {
      autoPlayCheckbox.disabled = false;
      syncAutoPlayMode();
    }
    audioOutputDeviceSelect.disabled = false;
    latencyHintSelect.disabled = false;
    sampleRateSelect.disabled = false;
    if (renderSizeHintSelect) {
      renderSizeHintSelect.disabled = false;
    }
    if (renderSizeHintCustomInput) {
      renderSizeHintCustomInput.disabled = false;
    }
    if (webaudioQuantumBadge) {
      webaudioQuantumBadge.hidden = true;
      webaudioQuantumBadge.textContent = '';
    }
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
    for (const key of Object.keys(snapshotState)) {
      snapshotState[key] = null;
    }
    if (rtpStatsSectionContainer) {
      rtpStatsSectionContainer.hidden = true;
    }
    outboundRtpStatsElement.textContent = '';
    outboundRtpStatsElement.hidden = true;
    inboundRtpStatsElement.textContent = '';
    inboundRtpStatsElement.hidden = true;
    audioPlayoutStatsElement.textContent = '';
    audioPlayoutStatsElement.hidden = true;
    audioPlayoutStatsElement.classList.remove('glitch-active');
    previousStats = null;
    previousTrackProperties = null;
    previousOutboundRtpStats = null;
    previousInboundRtpStats = null;
    previousPlayoutStats = null;
    total_intervals = 0;
    glitchy_intervals = 0;
    glitchWindow.length = 0;
    simulatedGlitchMode = 'none';
    simulatedGlitchCumulativeEvents = 0;
    simulatedGlitchCumulativeDuration = 0;
    updateVisualizerRmsLabel();
    if (glitchSimulationTimer) {
      clearInterval(glitchSimulationTimer);
      glitchSimulationTimer = null;
      const b = document.getElementById('simulate-glitch-cycle-btn');
      if (b) {
        b.disabled = false;
        b.textContent = 'Simulate Cycle';
      }
    }
    const glitchSelect = document.getElementById('simulate-glitch-select');
    if (glitchSelect) {
      glitchSelect.value = 'none';
    }
    if (recordedAudioContainer) {
      recordedAudioContainer.hidden = true;
    }
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    lastRecordedBlob = null;
    lastRecordedMimeType = '';
    recordedVisualizer.hidden = true;
    stopRecordedLevelMeter(true);
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
    isRecording = false;
    updateRecordButtonUI();
    errorMessageElement.textContent = '';
    errorMessageElement.hidden = true;
    bookmarkUrlContainer.innerHTML = ''; // Clear the bookmark URL
    // Reset to default error colors from CSS
    errorMessageElement.classList.remove('notice');
    debugLog('Stream stopped and visualizer cleared.');
    logLifecycleEvent('Stream', 'Stream stopped and audio pipeline closed');
  });

  let activeToastTimeout = null;
  function showToastNotification(message, durationMs = 5000) {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast-notification';
      toast.className = 'toast-notification';
      toast.setAttribute('role', 'status');
      document.body.appendChild(toast);
    }
    toast.innerHTML = `<span class="toast-dot" aria-hidden="true"></span><span>${escapeHtml(message)}</span>`;
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
      recordedAudioContainer.hidden = true;
    }
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    lastRecordedBlob = null;
    lastRecordedMimeType = '';
    recordedVisualizer.hidden = true;
    stopRecordedLevelMeter(true);
    recordedChunks = [];
    try {
      // Record what is sent and played: the sine tone if it is on when
      // recording starts, otherwise the capture stream. A MediaRecorder cannot
      // switch tracks, so toggling the tone later does not change the source.
      recordingSineTone = !!(micSourceRadio.checked && sineToneCheckbox.checked && sineToneStream);
      const recordStream = recordingSineTone ? sineToneStream : localStream;
      logLifecycleEvent('MediaRecorder', `Recording source: ${recordingSineTone ? '440 Hz sine tone' : (micSourceRadio.checked ? 'microphone' : 'audio file')}`);
      mediaRecorder = new MediaRecorder(recordStream, { mimeType });
      mediaRecorder.onstart = () => debugLog('MediaRecorder started.', 'MimeType:', mimeType, isAuto ? '(Auto-record)' : '');
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };
      mediaRecorder.onstop = () => {
        debugLog('MediaRecorder stopped.');
        if (recordingSineTone) {
          recordingSineTone = false;
          // The tone was switched off during the recording; stop it now.
          if (!sineToneCheckbox.checked) stopSineToneGenerator();
        }
        const recordedBlob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
        lastRecordedBlob = recordedBlob;
        lastRecordedMimeType = mimeType || 'audio/webm';
        const audioUrl = URL.createObjectURL(recordedBlob);
        recordedAudio.src = audioUrl;
        if (recordedAudioContainer) {
          recordedAudioContainer.hidden = false;
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
        errorMessageElement.hidden = false;
        logLifecycleEvent('MediaRecorder Error', `${event.error.name}: ${event.error.message || 'Unknown error'}`, 'error');
      };
      mediaRecorder.start();
    } catch (err) {
      console.error('Failed to create MediaRecorder:', err);
      isRecording = false;
      updateRecordButtonUI();
      errorMessageElement.textContent = `MediaRecorder Error: ${err.message}`;
      errorMessageElement.hidden = false;
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
      debugLog('Recorded audio playback started.');
      recordedVisualizer.hidden = false;
      
      // Create the context and source node only once.
      if (!recordedAudioContext) {
        debugLog('Creating new (and final) recorded audio context.');
        recordedAudioContext = new AudioContext();
        debugLog('AudioContext sample rate:', recordedAudioContext.sampleRate);
      }
      
      if (!recordedSourceNode) {
        debugLog('Creating new (and final) media element source node.');
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

      if (recordedAudioContext.state === 'suspended') {
        recordedAudioContext.resume();
      }

      stopRecordedVisualization();
      if (hasRecordedLevelMeter()) {
        startRecordedLevelMeter(recordedAnalyser);
      } else {
        drawRecordedVisualizer();
      }
    } catch (err) {
      console.error('Error visualizing recorded audio:', err);
      errorMessageElement.textContent = `Visualization Error: ${err.message}`;
      errorMessageElement.hidden = false;
    }
  });

  // clear = true also empties the level meter bar and label.
  function stopRecordedVisualization(clear = false) {
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    stopRecordedLevelMeter(clear);
  }

  // Suspend the playback context while idle so it does not keep an output
  // stream open in the background and skew other audio measurements.
  function suspendRecordedAudioContext() {
    if (recordedAudioContext && recordedAudioContext.state === 'running') {
      recordedAudioContext.suspend();
    }
  }

  recordedAudio.addEventListener('pause', () => {
    debugLog('Recorded audio playback paused.');
    stopRecordedVisualization();
    suspendRecordedAudioContext();
  });

  recordedAudio.addEventListener('ended', () => {
    debugLog('Recorded audio playback ended.');
    stopRecordedVisualization(true);
    suspendRecordedAudioContext();
  });

  // Optional: repeat the recording. With loop on the element
  // does not fire 'ended', so the level meter keeps running across repeats.
  const recordedLoopCheckbox = document.getElementById('recorded-loop-checkbox');
  if (recordedLoopCheckbox) {
    recordedLoopCheckbox.addEventListener('change', () => {
      recordedAudio.loop = recordedLoopCheckbox.checked;
      debugLog(`Recorded audio loop ${recordedAudio.loop ? 'on' : 'off'}`);
    });
  }

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
            debugLog(`Audio output device set to: ${deviceIdToSet || 'default'}`);
          }
          await audioPlayback.play();
          await updateAudioOutputInfo(audioPlayback.sinkId);
          audioOutputInfoElement.hidden = false;
          audioOutputDeviceSelect.disabled = true;
          logLifecycleEvent('HTML:Play', `Playback started (sinkId: ${audioOutputDeviceSelect.value || 'default'})`);
        } catch (err) {
          console.error('Error setting audio output device:', err);
          errorMessageElement.textContent = `Error setting sinkId: ${err.name} - ${err.message}`;
          errorMessageElement.hidden = false;
          // Revert the UI state since we failed.
          htmlPlayCheckbox.checked = false;
          updateHtmlPlayTooltip();
          audioOutputDeviceSelect.disabled = false;
          logLifecycleEvent('HTML:Play', `Failed to start playback (${err.name})`);
        }
      } else {
        await audioPlayback.pause();
        audioOutputInfoElement.hidden = true;
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
          let contextOptions = {};
          if (!webAudioContext || webAudioContext.state === 'closed') {
            const latencyHint = latencyHintSelect.value;
            const sampleRate = sampleRateSelect.value;
            const renderSizeHintVal = renderSizeHintSelect ? renderSizeHintSelect.value : 'undefined';
            contextOptions = {};
            if (latencyHint !== 'undefined') {
              contextOptions.latencyHint = latencyHint;
            }
            if (sampleRate !== 'undefined') {
              contextOptions.sampleRate = parseInt(sampleRate, 10);
            }
            if (renderSizeHintVal !== 'undefined') {
              if (renderSizeHintVal === 'custom') {
                const customVal = parseInt(renderSizeHintCustomInput.value, 10);
                if (!isNaN(customVal)) {
                  contextOptions.renderSizeHint = customVal;
                }
              } else if (renderSizeHintVal === 'hardware' || renderSizeHintVal === 'default') {
                contextOptions.renderSizeHint = renderSizeHintVal;
              } else {
                const intVal = parseInt(renderSizeHintVal, 10);
                if (!isNaN(intVal)) {
                  contextOptions.renderSizeHint = intVal;
                }
              }
            }
            debugLog('AudioContext contextOptions:', contextOptions);
            webAudioContext = new AudioContext(contextOptions);
            debugLog('AudioContext base latency:', webAudioContext.baseLatency);
            debugLog('AudioContext renderQuantumSize:', webAudioContext.renderQuantumSize);
            debugLog(webAudioContext.renderQuantumSize);
          }

          const sinkId = audioOutputDeviceSelect.value;
          if ('setSinkId' in webAudioContext) {
            const deviceIdToSet = sinkId === 'undefined' ? '' : sinkId;
            await webAudioContext.setSinkId(deviceIdToSet);
            debugLog(`Audio output device set to: ${deviceIdToSet || 'default'}`);
          }

          webAudioSource = webAudioContext.createMediaStreamSource(streamForPlaybackAndVisualizer);
          webAudioSource.connect(webAudioContext.destination);

          if (webAudioContext.state === 'suspended') {
            await webAudioContext.resume();
          }
          await updateAudioOutputInfo(webAudioContext.sinkId);
          if (webAudioContext && webaudioContextInfoElement) {
            const qSize = webAudioContext.renderQuantumSize;
            const quantumDisplay = qSize !== undefined
                ? `${qSize} samples (${((qSize / webAudioContext.sampleRate) * 1000).toFixed(2)} ms)`
                : '128 (default/legacy)';
            const hintDisplay = contextOptions.renderSizeHint !== undefined
                ? ` (renderSizeHint: ${contextOptions.renderSizeHint})`
                : ' (renderSizeHint: default)';
            const baseLatencyDisplay = `${(webAudioContext.baseLatency * 1000).toFixed(1)} ms`;
            snapshotState.webAudioContext = {
              sampleRate: `${webAudioContext.sampleRate} Hz`,
              baseLatency: baseLatencyDisplay,
              renderQuantumSize: quantumDisplay,
              renderSizeHint: contextOptions.renderSizeHint !== undefined
                  ? String(contextOptions.renderSizeHint)
                  : 'default',
            };
            webaudioContextInfoElement.textContent = `WebAudio Context:\n` +
                `  sampleRate: ${webAudioContext.sampleRate} Hz\n` +
                `  baseLatency: ${baseLatencyDisplay}\n` +
                `  renderQuantumSize: ${quantumDisplay}${hintDisplay}`;
            webaudioContextInfoElement.hidden = false;
          }
          audioOutputInfoElement.hidden = false;
          audioOutputDeviceSelect.disabled = true;
          latencyHintSelect.disabled = true;
          sampleRateSelect.disabled = true;
          if (renderSizeHintSelect) renderSizeHintSelect.disabled = true;
          if (renderSizeHintCustomInput) renderSizeHintCustomInput.disabled = true;

          if (webaudioQuantumBadge) {
            const qSize = webAudioContext.renderQuantumSize;
            if (qSize !== undefined) {
              const ms = ((qSize / webAudioContext.sampleRate) * 1000).toFixed(2);
              webaudioQuantumBadge.textContent = `quantum: ${qSize}`;
              webaudioQuantumBadge.setAttribute(
                  'data-tooltip',
                  `Negotiated audioContext.renderQuantumSize: ${qSize} samples (${ms} ms at ${webAudioContext.sampleRate} Hz).`
              );
              webaudioQuantumBadge.hidden = false;
            } else {
              webaudioQuantumBadge.textContent = 'quantum: 128 (legacy)';
              webaudioQuantumBadge.setAttribute('data-tooltip', 'renderQuantumSize not supported in this browser; running at standard 128-sample quantum.');
              webaudioQuantumBadge.hidden = false;
            }
          }

          const quantumLog = webAudioContext.renderQuantumSize !== undefined
              ? `, renderQuantumSize: ${webAudioContext.renderQuantumSize}`
              : '';
          const hintLog = contextOptions.renderSizeHint !== undefined
              ? `, renderSizeHint: ${contextOptions.renderSizeHint}`
              : '';
          logLifecycleEvent('WebAudio:Play', `AudioContext playback started (sampleRate: ${webAudioContext.sampleRate}Hz, baseLatency: ${(webAudioContext.baseLatency * 1000).toFixed(1)}ms${quantumLog}${hintLog})`);
        } catch (err) {
          console.error('WebAudio Playback setup failed:', err);
          errorMessageElement.textContent = `WebAudio Error: ${err.name} - ${err.message}`;
          errorMessageElement.hidden = false;
          webaudioPlayCheckbox.checked = false;
          updateWebAudioPlayTooltip();
          audioOutputDeviceSelect.disabled = false;
          latencyHintSelect.disabled = false;
          sampleRateSelect.disabled = false;
          if (renderSizeHintSelect) renderSizeHintSelect.disabled = false;
          if (renderSizeHintCustomInput) renderSizeHintCustomInput.disabled = false;
          if (webaudioQuantumBadge) {
            webaudioQuantumBadge.hidden = true;
            webaudioQuantumBadge.textContent = '';
          }
          snapshotState.webAudioContext = null;
          if (webaudioContextInfoElement) {
            webaudioContextInfoElement.hidden = true;
            webaudioContextInfoElement.textContent = '';
          }
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
        audioOutputInfoElement.hidden = true;
        snapshotState.webAudioContext = null;
        if (webaudioContextInfoElement) {
          webaudioContextInfoElement.hidden = true;
          webaudioContextInfoElement.textContent = '';
        }
        audioOutputDeviceSelect.disabled = false;
        latencyHintSelect.disabled = false;
        sampleRateSelect.disabled = false;
        if (renderSizeHintSelect) renderSizeHintSelect.disabled = false;
        if (renderSizeHintCustomInput) renderSizeHintCustomInput.disabled = false;
        if (webaudioQuantumBadge) {
          webaudioQuantumBadge.hidden = true;
          webaudioQuantumBadge.textContent = '';
        }
        logLifecycleEvent('WebAudio:Play', 'AudioContext playback stopped');
      }
    }
  });

  if (renderSizeHintSelect) {
    renderSizeHintSelect.addEventListener('change', () => {
      if (renderSizeHintSelect.value === 'custom') {
        renderSizeHintCustomInput.hidden = false;
        renderSizeHintCustomInput.focus();
      } else {
        renderSizeHintCustomInput.hidden = true;
      }
    });
  }

  sineToneCheckbox.addEventListener('change', async () => {
    if (!localStream || !micSourceRadio.checked) return;
    const [micTrack] = localStream.getAudioTracks();
    if (!micTrack) return;

    if (sineToneCheckbox.checked) {
      const toneStream = startSineToneGenerator();
      if (!toneStream) return;
      const [toneTrack] = toneStream.getAudioTracks();
      if (!toneTrack) return;

      logLifecycleEvent('SineTone', 'Replaced microphone audio with 440 Hz sine tone (physical mic remains open)');
      if (pc1) {
        const senders = pc1.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio') || senders[0];
        if (audioSender) {
          await audioSender.replaceTrack(toneTrack);
          debugLog('RTCRtpSender.replaceTrack switched to 440Hz sine tone track.');
        }
      } else {
        streamForPlaybackAndVisualizer = toneStream;
        audioPlayback.srcObject = toneStream;
        visualizeAudio(toneStream);
      }
    } else {
      if (pc1) {
        const senders = pc1.getSenders();
        const audioSender = senders.find(s => s.track && s.track.kind === 'audio') || senders[0];
        if (audioSender) {
          await audioSender.replaceTrack(micTrack);
          debugLog('RTCRtpSender.replaceTrack switched back to live mic track.');
        }
      } else {
        streamForPlaybackAndVisualizer = localStream;
        audioPlayback.srcObject = localStream;
        visualizeAudio(localStream);
      }
      // Keep the tone running while MediaRecorder records it (see startRecording).
      if (!(recordingSineTone && mediaRecorder && mediaRecorder.state === 'recording')) {
        stopSineToneGenerator();
      }
      logLifecycleEvent('SineTone', 'Restored live microphone audio');
    }

    // Refresh active audio source device info display
    const devices = await navigator.mediaDevices.enumerateDevices();
    const selectedDevice = devices.find(device => device.kind === 'audioinput' && device.deviceId === micTrack.getSettings().deviceId);
    if (selectedDevice) {
      renderMicSourceInfo(selectedDevice, sineToneCheckbox.checked);
    }
  });

  audioPlayback.addEventListener('play', async () => {
    debugLog('Audio playback started.');
    await updateAudioOutputInfo(audioPlayback.sinkId);
    audioOutputInfoElement.hidden = false;
  });

  audioPlayback.addEventListener('pause', () => {
    debugLog('Audio playback paused.');
  });

  navigator.mediaDevices.addEventListener('devicechange', async () => {
    debugLog('--- navigator.mediaDevices "devicechange" event received ---');
    invalidateAudioHardwareInfo();

    // Check if the currently active microphone device was disconnected
    if (localStream && micSourceRadio.checked) {
      const [audioTrack] = localStream.getAudioTracks();
      if (audioTrack) {
        const settings = audioTrack.getSettings ? audioTrack.getSettings() : {};
        const activeDeviceId = settings.deviceId;
        debugLog('devicechange: inspecting active audio track:', {
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
            errorMessageElement.hidden = false;
          } else {
            debugLog(`devicechange: active audio device "${audioTrack.label || activeDeviceId}" is still connected.`);
          }
        } catch (e) {
          console.warn('Error checking device disconnection on devicechange:', e);
        }
      }
    }

    await populateAudioInputDevices();
    await populateAudioOutputDevices();
    await populateSystemInfo();
    debugLog('devicechange: device lists and System Diagnostics updated.');
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

    if (autoPlayCheckbox && autoPlayCheckbox.checked) {
      params.set('autoPlay', 'true');
      if (autoPlayModeName() === 'WebAudio:Play') params.set('autoPlayMode', 'webaudio');
    }

    if (sineToneCheckbox && sineToneCheckbox.checked) {
      params.set('sineTone', 'true');
    }

    // Construct the full bookmarkable URL, only adding a '?' if there are parameters.
    const queryString = params.toString();
    const bookmarkUrl = queryString
      ? `${window.location.origin}${window.location.pathname}?${queryString}`
      : `${window.location.origin}${window.location.pathname}`;
    debugLog('Bookmark URL:', bookmarkUrl);
    
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
  let micPermissionStatusObject = null;


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

        // Auto-refresh when user updates permissions. Only attach once; each
        // query() returns a new PermissionStatus object, and attaching to every
        // one would multiply refreshes on a single permission change.
        if (!micPermissionStatusObject) {
          micPermissionStatusObject = status;
          status.addEventListener('change', () => {
            populateSystemInfo();
            populateAudioInputDevices();
          });
        }
      } catch (e) {
        permissionStatus = `Error: ${e.message}`;
        lastPermissionStatus = permissionStatus;
      }
    }

    let permissionClass = 'status-warn';
    if (permissionStatus === 'granted') permissionClass = 'status-ok';
    if (permissionStatus === 'denied') permissionClass = 'status-bad';

    // 1. System Resources
    const cores = navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} Cores` : null;
    const mem = navigator.deviceMemory ? `${navigator.deviceMemory} GB RAM` : null;
    const systemResources = [cores, mem].filter(Boolean).join(', ') || 'N/A';

    // 2. Audio Hardware & Context defaults
    let hwSampleRate = 'N/A';
    let hwBaseLatency = 'N/A';
    let hwOutputLatency = 'N/A';
    let hwRenderQuantum = 'N/A';
    if (audioContextSupported) {
      ({ hwSampleRate, hwBaseLatency, hwOutputLatency, hwRenderQuantum } = getAudioHardwareInfo());
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

    const quantumSupported = typeof AudioContext !== 'undefined' && ('renderQuantumSize' in AudioContext.prototype);

    infoDiv.innerHTML = `
      <strong>Browser:</strong> ${browser.name} ${browser.version} (${os})<br>
      <strong>Secure Context:</strong> ${isSecure ? '<span class="status-ok">Yes</span>' : '<span class="status-bad">No (getUserMedia will fail)</span>'}<br>
      <strong>Microphone Permission:</strong> <span class="${permissionClass}">${escapeHtml(permissionStatus)}</span><br>
      <strong>Origin:</strong> ${protocol}//${host}<br>
      <strong>System Resources:</strong> ${systemResources}<br>
      <strong>Hardware Audio:</strong> Sample Rate: ${hwSampleRate}, Base Latency: ${hwBaseLatency}, Output Latency: ${hwOutputLatency}, Render Quantum: ${hwRenderQuantum}<br>
      <strong>Detected Devices:</strong> ${displayedInputs}, ${displayedOutputs}<br>
      <strong>Compute Pressure (CPU):</strong> <span id="compute-pressure-status">${formatComputePressureHtml(latestComputePressure)}</span> <button id="simulate-pressure-cycle-btn" data-tooltip="Run an automated ~10-second simulation cycle (nominal -> fair -> serious -> critical -> serious -> fair -> nominal) to test app adaptation to CPU pressure.">Simulate Cycle</button> <select id="simulate-pressure-select" data-tooltip="Manually inject a simulated Compute Pressure state into the observer pipeline without placing real load on your physical processor."><option value="" disabled selected>Set State...</option><option value="nominal">nominal (25% load)</option><option value="fair">fair (50% load)</option><option value="serious">serious (75% load)</option><option value="critical">critical (100% load)</option></select> <span class="info-icon" tabindex="0" role="img" data-tooltip="Simulates Compute Pressure API (PressureObserver) CPU load states without placing actual load on your physical processor. Injects nominal, fair, serious, and critical states to test how WebRTC applications adapt (e.g. lowering video quality or disabling heavy audio processing) under varying system thermal and workload conditions.">i</span><br>
      <div id="compute-pressure-graph-container">
        <div class="cp-graph-header">
          <span class="cp-graph-title" data-tooltip="Real-time 1Hz rolling history mapping Compute Pressure CPU states to normalized load values (nominal=25%, fair=50%, serious=75%, critical=100%).">Compute Pressure History (1Hz Mapped States)</span>
          <span id="compute-pressure-graph-legend" data-tooltip="Color-coded 1Hz load thresholds: Light (25% nominal), Moderate (50% fair), High (75% serious), Heavy (100% critical).">
            <span class="cp-nominal">● light (25%)</span> |
            <span class="cp-fair">● moderate (50%)</span> |
            <span class="cp-serious">● high (75%)</span> |
            <span class="cp-critical">● heavy (100%)</span>
          </span>
        </div>
        <canvas id="compute-pressure-canvas" height="85"></canvas>
      </div>
      <strong>APIs Supported:</strong> getUserMedia:${gumSupported ? '✅' : '❌'}, applyConstraints:${applyConstraintsSupported ? '✅' : '❌'}, setSinkId:${setSinkIdSupported ? '✅' : '❌'}, RTCPeerConnection:${peerConnectionSupported ? '✅' : '❌'}, MediaRecorder:${mediaRecorderSupported ? '✅' : '❌'}, Web Audio:${audioContextSupported ? '✅' : '❌'}, Render Quantum:${quantumSupported ? '✅' : '❌'}, Track Stats:${statsSupported ? '✅' : '❌'}, captureStream:${captureStreamSupported ? '✅' : '❌'}, Compute Pressure:${computePressureSupported ? '✅' : '❌'}<br>
      <strong>Supported Constraints:</strong> ${constraintsSummary}<br>
      <details class="ua-details">
        <summary>Raw User Agent</summary>
        <pre>${escapeHtml(navigator.userAgent)}</pre>
      </details>
    `;
    labelInfoIcons(infoDiv);

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
    // Build the MediaStreamTrack getters and properties sub-object.
    const trackSection = {
      'getConstraints()': snapshotState.trackConstraints,
      'getSettings()': snapshotState.trackSettings,
      'properties': snapshotState.trackProperties,
      'stats': snapshotState.trackStats,
    };
    for (const key in trackSection) {
      const value = trackSection[key];
      if (value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0)) {
        delete trackSection[key];
      }
    }

    // Build the RTCPeerConnection audio reports sub-object.
    const rtpStatsSection = {
      'outbound-rtp (pc1)': snapshotState.outboundRtp,
      'inbound-rtp (pc2)': snapshotState.inboundRtp,
      'audio-playout (pc2)': snapshotState.audioPlayout,
    };
    for (const key in rtpStatsSection) {
      const value = rtpStatsSection[key];
      if (value === null || value === '' || (typeof value === 'object' && Object.keys(value).length === 0)) {
        delete rtpStatsSection[key];
      }
    }

    // For audio file sources, add the current playback position at snapshot time.
    let activeAudioSource = snapshotState.audioSource;
    if (activeAudioSource && activeAudioSource.type === 'Audio File' && fileSourceAudio.duration) {
      activeAudioSource = {
        ...activeAudioSource,
        time: `${fileSourceAudio.currentTime.toFixed(2)}s / ${fileSourceAudio.duration.toFixed(2)}s`,
      };
    }

    const browser = getBrowserInfo();
    const os = getOSInfo();
    const hwInfo = (window.AudioContext || window.webkitAudioContext)
        ? getAudioHardwareInfo()
        : { hwSampleRate: 'N/A', hwBaseLatency: 'N/A', hwOutputLatency: 'N/A', hwRenderQuantum: 'N/A' };

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
        'Native Sample Rate': hwInfo.hwSampleRate,
        'Base Latency': hwInfo.hwBaseLatency,
        'Output Latency': hwInfo.hwOutputLatency,
        'Render Quantum': hwInfo.hwRenderQuantum,
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
        'Configurable Render Quantum': typeof AudioContext !== 'undefined' && ('renderQuantumSize' in AudioContext.prototype),
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
      'Auto-Play': autoPlayCheckbox ? autoPlayCheckbox.checked : false,
      'Auto-Play Mode': autoPlayModeName(),
      'Active audio source': activeAudioSource,
      'Active audio output device': snapshotState.audioOutput,
      'Active WebAudio Context': snapshotState.webAudioContext,
      'WebAudio latencyHint': latencyHintSelect.value,
      'WebAudio sampleRate': sampleRateSelect.value,
      'WebAudio renderSizeHint': renderSizeHintSelect ? (renderSizeHintSelect.value === 'custom' ? renderSizeHintCustomInput.value : renderSizeHintSelect.value) : undefined,
      'WebAudio renderQuantumSize': webAudioContext ? webAudioContext.renderQuantumSize : undefined,
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
    debugLog('snapshotJson:', snapshotJson);
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
    if (e.target && e.target.id === 'simulate-glitch-cycle-btn') {
      runGlitchSimulationCycle();
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
    if (e.target && e.target.id === 'simulate-glitch-select') {
      const selected = e.target.value;
      if (selected) {
        setSimulatedGlitchMode(selected);
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
  initTooltipA11y();
  await initComputePressureObserver();
  populateSystemInfo();
  await populateAudioInputDevices();
  await populateAudioOutputDevices();
  applyUrlParameters();
});