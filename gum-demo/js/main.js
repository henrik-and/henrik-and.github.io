document.addEventListener('DOMContentLoaded', async () => {
  const gumButton = document.getElementById('gum-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const channelCountSelect = document.getElementById('channelCount');
  const errorMessageElement = document.getElementById('error-message');
  const audioDeviceSelect = document.querySelector('#audioDevice');
  const audioOutputDeviceSelect = document.querySelector('#audioOutputDevice');
  const latencyHintSelect = document.querySelector('#latencyHint');
  
  const visualizerCanvas = document.querySelector('#audio-visualizer');
  const canvasCtx = visualizerCanvas.getContext('2d');
  const stopButton = document.querySelector('#stop-button');
  const recordButton = document.querySelector('#record-button');
  const streamControlsContainer = document.querySelector('#stream-controls-container');
  const muteCheckbox = document.querySelector('#mute-checkbox');
  const htmlPlayCheckbox = document.querySelector('#html-play-checkbox');
  const webaudioPlayCheckbox = document.querySelector('#webaudio-play-checkbox');
  const audioPlayback = document.querySelector('#audio-playback');
  const trackSettingsElement = document.querySelector('#track-settings');
  const trackPropertiesElement = document.querySelector('#track-properties');
  const trackStatsElement = document.querySelector('#track-stats');
  const trackConstraintsElement = document.querySelector('#track-constraints');
  const audioInputDeviceElement = document.querySelector('#audio-input-device');
  const audioOutputInfoElement = document.querySelector('#audio-output-info');
  const audioDevicesContainer = document.querySelector('#audio-devices-container');
  const recordedAudio = document.querySelector('#recorded-audio');
  const recordedVisualizer = document.querySelector('#recorded-visualizer');
  const copyBookmarkButton = document.getElementById('copy-bookmark-button');
  const bookmarkUrlContainer = document.getElementById('bookmark-url-container');
  const saveSnapshotButton = document.getElementById('save-snapshot-button');
  const snapshotButtonContainer = document.getElementById('snapshot-button-container');
  const peerConnectionCheckbox = document.getElementById('peerconnection-checkbox');
  const outboundRtpStatsElement = document.getElementById('outbound-rtp-stats');
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
  let webAudioContext;
  let webAudioSource;
  let statsInterval;
  let previousStats = null;
  let previousTrackProperties = null;
  let pc1, pc2;
  let previousOutboundRtpStats = null;
  let previousInboundRtpStats = null;
  let previousPlayoutStats = null;
  let total_intervals = 0;
  let glitchy_intervals = 0;

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



  const peerConnectionLabel = peerConnectionCheckbox.parentElement.querySelector('label');

  function updatePeerConnectionTooltip() {
    if (peerConnectionCheckbox.checked) {
      // State is ENABLED. Tooltip is removed.
      peerConnectionLabel.title = '';
    } else {
      // State is DISABLED. Tooltip describes the action of checking it.
      peerConnectionLabel.title = 'Send and receive the recorded local audio track via an RTCPeerConnection in loopback using Opus stereo as encoder and decoder';
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

  // Set the initial tooltip state on page load.
  updatePeerConnectionTooltip();

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
    setSelectValue('channelCount', channelCountSelect);
    setSelectValue('deviceId', audioDeviceSelect);

    if (params.has('peerConnection') && params.get('peerConnection') === 'true') {
      peerConnectionCheckbox.checked = true;
      // Manually trigger the change event to ensure the rest of the app state is updated.
      peerConnectionCheckbox.dispatchEvent(new Event('change'));
    }

    console.log(`applyUrlParameters: echoCancellation from URL is "${params.get('echoCancellation')}"`);
    console.log(`applyUrlParameters: autoGainControl from URL is "${params.get('autoGainControl')}"`);
    console.log(`applyUrlParameters: noiseSuppression from URL is "${params.get('noiseSuppression')}"`);
    console.log(`applyUrlParameters: channelCount from URL is "${params.get('channelCount')}"`);
    console.log(`applyUrlParameters: deviceId from URL is "${params.get('deviceId')}"`);
  }

  function setConstraintsDisabled(disabled) {
    echoCancellationSelect.disabled = disabled;
    autoGainControlSelect.disabled = disabled;
    noiseSuppressionSelect.disabled = disabled;
    channelCountSelect.disabled = disabled;
    audioDeviceSelect.disabled = disabled;
  }

  function updateRecordButtonUI() {
    if (isRecording) {
      recordButton.classList.add('recording-active');
      recordButton.innerHTML = 'Stop';
    } else {
      recordButton.classList.remove('recording-active');
      recordButton.innerHTML = '<span class="record-dot"></span>Rec';
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
    const header = 'MediaStreamTrack properties:\n';
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
        // We fade the background color to transparent to smoothly return to the original.
        el.style.backgroundColor = 'transparent';
      });
    }, 2000);
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

      trackStatsElement.textContent = 'MediaStreamTrackAudioStats:\n' + JSON.stringify(extendedStats, null, 2);

      // Update previousStats for the next call, storing only the necessary fields.
      previousStats = {
        deliveredFrames: currentStats.deliveredFrames,
        totalFrames: currentStats.totalFrames,
        droppedFrames: extendedStats.droppedFrames,
      };
    } else {
      trackStatsElement.textContent = 'MediaStreamTrackAudioStats:\nNot supported';
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
      outboundRtpStatsElement.style.display = 'none';
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
              const bitsSent = (stats.bytesSent - previousOutboundRtpStats.bytesSent) * 8;
              const packetsSent = stats.packetsSent - previousOutboundRtpStats.packetsSent;
              displayStats.rate = {
                bps: Math.round(bitsSent / timeDiffSeconds),
                pps: parseFloat((packetsSent / timeDiffSeconds).toFixed(1)),
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
          outboundRtpStatsElement.textContent = 'RTCOutboundRtpStreamStats:\n' + JSON.stringify(displayStats, null, 2);
          inboundRtpStatsElement.textContent = 'RTCInboundRtpStreamStats:\n';
          audioPlayoutStatsElement.textContent = 'RTCAudioPlayoutStats:\n';
        }
      }
      // Show or hide the element based on whether stats were found in this report.
      outboundRtpStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
      inboundRtpStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
      audioPlayoutStatsElement.style.display = outboundStatsFound ? 'block' : 'none';
    } catch (err) {
      console.error('Error getting RTP stats:', err);
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
              const bps = (timeDiffSeconds > 0) ? Math.round((deltaBytesReceived * 8) / timeDiffSeconds) : 0;
              const rate = {
                bps: bps,
                packetsDiscarded: deltaPacketsDiscarded,
                concealedSamples: deltaConcealedSamples,
              };

              // Calculate and add interval-specific RMS audio level.
              if (previousInboundRtpStats.totalAudioEnergy !== undefined && previousInboundRtpStats.totalSamplesDuration !== undefined) {
                const deltaTotalAudioEnergy = stats.totalAudioEnergy - previousInboundRtpStats.totalAudioEnergy;
                const deltaTotalSamplesDuration = stats.totalSamplesDuration - previousInboundRtpStats.totalSamplesDuration;
                if (deltaTotalSamplesDuration > 0) {
                  const rms = Math.sqrt(deltaTotalAudioEnergy / deltaTotalSamplesDuration);
                  rate.rmsAudioLevel = parseFloat(rms.toFixed(2));
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

            if (stats.packetsDiscarded !== undefined) {
              displayStats.packetsDiscarded = stats.packetsDiscarded;
            }
            if (stats.concealedSamples !== undefined) {
              displayStats.concealedSamples = stats.concealedSamples;
            }

            console.log('stats.totalAudioEnergy:', stats.totalAudioEnergy);
            if (stats.totalAudioEnergy !== undefined) {
              displayStats.totalAudioEnergy = parseFloat(stats.totalAudioEnergy.toFixed(1));
            }

            // audioLevel is only reported when the track is actively being played out.
            // The value is linear from 0.0 (silence) to 1.0 (0 dBov).
            // A value of 0.5 represents approximately a 6 dBSPL change.
            // The audioLevel is averaged over some small interval.
            if (stats.audioLevel !== undefined && stats.audioLevel > 0) {
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
            };
            inboundRtpStatsElement.textContent = 'RTCInboundRtpStreamStats:\n' + JSON.stringify(displayStats, null, 2);
          }
          if (stats.type === 'media-playout') {
            playoutStatsFound = true;
            const displayStats = {};

            // Calculate and add interval-specific rates.
            if (previousPlayoutStats) {
              const deltaGlitchDuration = stats.synthesizedSamplesDuration - previousPlayoutStats.synthesizedSamplesDuration;
              const deltaTotalSamplesDuration = stats.totalSamplesDuration - previousPlayoutStats.totalSamplesDuration;
              const deltaTotalPlayoutDelay = stats.totalPlayoutDelay - previousPlayoutStats.totalPlayoutDelay;
              const deltaTotalSamplesCount = stats.totalSamplesCount - previousPlayoutStats.totalSamplesCount;
              const deltaGlitchEvents = stats.synthesizedSamplesEvents - previousPlayoutStats.synthesizedSamplesEvents;

              const interval = {};
              interval.glitchEvents = deltaGlitchEvents;
              let glitchPercentage = (deltaTotalSamplesDuration > 0) ? (deltaGlitchDuration / deltaTotalSamplesDuration) * 100 : 0;
              interval.glitchPercentage = parseFloat(glitchPercentage.toFixed(1));
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

            displayStats.glitchEvents = stats.synthesizedSamplesEvents;
            displayStats.glitchDuration = parseFloat(stats.synthesizedSamplesDuration.toFixed(1));
            displayStats.totalSamplesDuration = parseFloat(stats.totalSamplesDuration.toFixed(1));

            if (stats.totalSamplesCount > 0) {
              const averagePlayoutDelayMs = (stats.totalPlayoutDelay / stats.totalSamplesCount) * 1000;
              displayStats.averagePlayoutDelayMs = parseFloat(averagePlayoutDelayMs.toFixed(1));
            }
            if (stats.totalSamplesDuration > 0) {
              const averageGlitchPercentage = (stats.synthesizedSamplesDuration / stats.totalSamplesDuration) * 100;
              displayStats.averageGlitchPercentage = parseFloat(averageGlitchPercentage.toFixed(1));
            }

            // Update previousPlayoutStats for the next interval.
            previousPlayoutStats = {
              synthesizedSamplesEvents: stats.synthesizedSamplesEvents,
              synthesizedSamplesDuration: stats.synthesizedSamplesDuration,
              totalSamplesDuration: stats.totalSamplesDuration,
              totalPlayoutDelay: stats.totalPlayoutDelay,
              totalSamplesCount: stats.totalSamplesCount,
            };

            audioPlayoutStatsElement.textContent = 'RTCAudioPlayoutStats:\n' + JSON.stringify(displayStats, null, 2);
          }
        }
        if (!playoutStatsFound) {
          audioPlayoutStatsElement.textContent = 'RTCAudioPlayoutStats:\n';
        }
        if (!inboundRtpStatsFound) {
          inboundRtpStatsElement.textContent = 'RTCInboundRtpStreamStats:\n';
        }
      } catch (err) {
        console.error('Error getting RTP stats from pc2:', err);
      }
    }
  }

  gumButton.addEventListener('click', async () => {
    gumButton.disabled = true;
    copyBookmarkButton.disabled = true;
    peerConnectionCheckbox.disabled = true;
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
    const audioConstraints = {};
    const echoCancellation = echoCancellationSelect.value;
    if (echoCancellation !== 'undefined') {
      audioConstraints.echoCancellation = echoCancellation === 'true' ? true :
          (echoCancellation === 'false' ? false : { exact: echoCancellation });
    }
    const autoGainControl = autoGainControlSelect.value;
    if (autoGainControl !== 'undefined') {
      audioConstraints.autoGainControl = autoGainControl === 'true';
    }
    const noiseSuppression = noiseSuppressionSelect.value;
    if (noiseSuppression !== 'undefined') {
      audioConstraints.noiseSuppression = noiseSuppression === 'true';
    }
    const channelCount = channelCountSelect.value;
    if (channelCount !== 'undefined') {
      audioConstraints.channelCount = parseInt(channelCount, 10);
    }
    const deviceId = audioDeviceSelect.value;
    if (deviceId !== 'undefined') {
      audioConstraints.deviceId = { exact: deviceId };
    }
    const constraints = {
      audio: Object.keys(audioConstraints).length === 0 ? true : audioConstraints,
      video: false
    };
    console.log('constraints:', JSON.stringify(constraints, null, 2));

    // For display purposes, create a deep copy and truncate the deviceId if it exists.
    const displayConstraints = structuredClone(constraints);
    if (displayConstraints.audio && displayConstraints.audio.deviceId && displayConstraints.audio.deviceId.exact) {
        const id = displayConstraints.audio.deviceId.exact;
        if (typeof id === 'string' && id !== 'default') {
            displayConstraints.audio.deviceId.exact = `${id.substring(0, 8)}..${id.substring(id.length - 8)}`;
        }
    }
    trackConstraintsElement.textContent = 'constraints:\n' + JSON.stringify(displayConstraints, null, 2);

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStream = stream;
      console.log('getUserMedia() successful');

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
          // Don't proceed with a broken stream setup
          return;
        }
      }

      const [audioTrack] = stream.getAudioTracks();
      console.log('audioTrack:', audioTrack);
      const settings = audioTrack.getSettings();
      console.log('MediaStreamTrack settings:', settings);
      if (settings.groupId && typeof settings.groupId === 'string') {
        settings.groupId = `${settings.groupId.substring(0, 8)}..${settings.groupId.substring(settings.groupId.length - 8)}`;
      }
      if (settings.deviceId && typeof settings.deviceId === 'string' && settings.deviceId !== 'default') {
        settings.deviceId = `${settings.deviceId.substring(0, 8)}..${settings.deviceId.substring(settings.deviceId.length - 8)}`;
      }
      trackSettingsElement.textContent = 'MediaStreamTrack settings:\n' + JSON.stringify(settings, null, 2);
      updateTrackProperties(audioTrack);
      statsInterval = setInterval(() => {
        updateTrackStats(audioTrack);
        updateRtpStats();
      }, 1000);
      audioTrack.onmute = (event) => {
        console.log('Audio track muted:', event);
        errorMessageElement.textContent = `Warning: Audio track muted - ${event.type}`;
        errorMessageElement.style.display = 'block';
        errorMessageElement.style.color = '#2F652F';
        errorMessageElement.style.backgroundColor = '#DFF2BF';
        errorMessageElement.style.borderColor = '#4F8A10';
        updateTrackProperties(audioTrack);
      };
      audioTrack.onunmute = (event) => {
        console.log('Audio track unmuted:', event);
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
        errorMessageElement.textContent = `Warning: Audio track ended - ${event.type}`;
        errorMessageElement.style.display = 'block';
        updateTrackProperties(audioTrack);
        clearInterval(statsInterval);
      };
      stopButton.disabled = false;
      recordButton.disabled = false;
      streamControlsContainer.style.display = 'flex';
      audioDevicesContainer.style.display = 'flex';
      snapshotButtonContainer.style.display = 'block';
      visualizeAudio(streamForPlaybackAndVisualizer);
      await populateAudioInputDevices();

      // Display the properties of the audio device that the track is actively using.
      // This is the source of truth, especially when 'undefined' is selected for deviceId,
      // as the browser will choose a default device. We get the deviceId from the
      // track's settings to ensure we display information about the device that is
      // actually in use.
      const devices = await navigator.mediaDevices.enumerateDevices();
      const selectedDevice = devices.find(device => device.kind === 'audioinput' && device.deviceId === audioTrack.getSettings().deviceId);
      if (selectedDevice) {
        audioInputDeviceElement.textContent = `Active audio input device:\n` +
            `  kind: ${selectedDevice.kind}\n` +
            `  label: ${selectedDevice.label}\n` +
            `  deviceId: ${selectedDevice.deviceId}\n` +
            `  groupId: ${selectedDevice.groupId}`;
      }

      audioPlayback.srcObject = streamForPlaybackAndVisualizer;
      htmlPlayCheckbox.checked = false;
      isRecording = false;
      updateRecordButtonUI();
    } catch (err) {
      console.error(err);
      errorMessageElement.textContent = `Error: ${err.name} - ${err.message}`;
      errorMessageElement.style.display = 'block';
      gumButton.disabled = false;
      copyBookmarkButton.disabled = false;
      peerConnectionCheckbox.disabled = false;
      setConstraintsDisabled(false);
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
    closePeerConnection();
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    if (webAudioContext) {
      webAudioContext.close();
      webAudioContext = null;
      webAudioSource = null;
    }
    clearInterval(statsInterval);
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.style.display = 'none';
    audioDevicesContainer.style.display = 'none';
    snapshotButtonContainer.style.display = 'none';
    audioOutputInfoElement.style.display = 'none';
    audioOutputInfoElement.textContent = '';
    gumButton.disabled = false;
    copyBookmarkButton.disabled = false;
    stopButton.disabled = true;
    recordButton.disabled = true;
    setConstraintsDisabled(false);
    peerConnectionCheckbox.disabled = false;
    audioOutputDeviceSelect.disabled = false;
    latencyHintSelect.disabled = false;
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    muteCheckbox.checked = false;
    htmlPlayCheckbox.checked = false;
    webaudioPlayCheckbox.checked = false;
    trackSettingsElement.textContent = '';
    trackPropertiesElement.textContent = '';
    trackStatsElement.textContent = '';
    trackConstraintsElement.textContent = '';
    audioInputDeviceElement.textContent = '';
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
    recordedAudio.style.display = 'none';
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    recordedVisualizer.style.display = 'none';
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
  });

  recordButton.addEventListener('click', () => {
    isRecording = !isRecording;
    updateRecordButtonUI();
    if (isRecording) {
      if (!localStream) {
        console.error('Cannot record: No active stream.');
        return;
      }
      recordedAudio.style.display = 'none';
      if (recordedAudio.src) {
        URL.revokeObjectURL(recordedAudio.src);
        recordedAudio.src = '';
      }
      recordedVisualizer.style.display = 'none';
      recordedChunks = [];
      const mimeType = findSupportedMimeType();
      try {
        mediaRecorder = new MediaRecorder(localStream, { mimeType });
        mediaRecorder.onstart = () => console.log('MediaRecorder started.', 'MimeType:', mimeType);
        mediaRecorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            recordedChunks.push(event.data);
          }
        };
        mediaRecorder.onstop = () => {
          console.log('MediaRecorder stopped.');
          const recordedBlob = new Blob(recordedChunks, { type: mimeType || 'audio/webm' });
          const audioUrl = URL.createObjectURL(recordedBlob);
          recordedAudio.src = audioUrl;
          recordedAudio.style.display = 'block';
        };
        mediaRecorder.onerror = (event) => {
          console.error('MediaRecorder error:', event.error);
          errorMessageElement.textContent = `Recorder Error: ${event.error.name}`;
          errorMessageElement.style.display = 'block';
        };
        mediaRecorder.start();
      } catch (err) {
        console.error('Failed to create MediaRecorder:', err);
        errorMessageElement.textContent = `MediaRecorder Error: ${err.message}`;
        errorMessageElement.style.display = 'block';
      }
    } else {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
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
    if (localStream) {
      const [audioTrack] = localStream.getAudioTracks();
      audioTrack.enabled = !muteCheckbox.checked;
      updateTrackProperties(audioTrack);
    }
  });

  htmlPlayCheckbox.addEventListener('change', async () => {
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
          audioOutputDeviceSelect.disabled = true;
          latencyHintSelect.disabled = true;
        } catch (err) {
          console.error('Error setting audio output device:', err);
          errorMessageElement.textContent = `Error setting sinkId: ${err.name} - ${err.message}`;
          errorMessageElement.style.display = 'block';
          // Revert the UI state since we failed.
          htmlPlayCheckbox.checked = false;
          audioOutputDeviceSelect.disabled = false;
          latencyHintSelect.disabled = false;
        }
      } else {
        await audioPlayback.pause();
        audioOutputInfoElement.style.display = 'none';
        audioOutputDeviceSelect.disabled = false;
        latencyHintSelect.disabled = false;
      }
    }
  });

  webaudioPlayCheckbox.addEventListener('change', async () => {
    if (streamForPlaybackAndVisualizer) {
      if (webaudioPlayCheckbox.checked) {
        try {
          if (!webAudioContext || webAudioContext.state === 'closed') {
            const latencyHint = latencyHintSelect.value;
            const contextOptions = {};
            if (latencyHint !== 'undefined') {
              contextOptions.latencyHint = latencyHint;
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
        } catch (err) {
          console.error('WebAudio Playback setup failed:', err);
          errorMessageElement.textContent = `WebAudio Error: ${err.message}`;
          errorMessageElement.style.display = 'block';
          webaudioPlayCheckbox.checked = false;
          audioOutputDeviceSelect.disabled = false;
          latencyHintSelect.disabled = false;
          if (webAudioContext) {
            webAudioContext.close();
            webAudioContext = null;
          }
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

  navigator.mediaDevices.addEventListener('devicechange', () => {
    populateAudioInputDevices();
    populateAudioOutputDevices();
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

    // Add the current constraint values to the search parameters.
    addParam('echoCancellation', echoCancellationSelect);
    addParam('autoGainControl', autoGainControlSelect);
    addParam('noiseSuppression', noiseSuppressionSelect);
    addParam('channelCount', channelCountSelect);
    addParam('deviceId', audioDeviceSelect);

    if (peerConnectionCheckbox.checked) {
      params.set('peerConnection', 'true');
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

  /**
   * Handles the click event of the 'Save Snapshot' button. It gathers all the displayed track
   * and device information, formats it into a structured JSON object, and triggers a download
   * for the user.
   */
  function handleSaveSnapshot() {
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

    // Create the main snapshot object. The `textContent` property of each DOM element
    // provides a string, which is then passed to the appropriate parsing function
    // to be converted into a structured object. The resulting `snapshot` is an object
    // where keys are strings (describing the data) and values are the parsed
    // results, which can be objects, strings, or null.
    const snapshot = {
      'Active audio input device': parseDeviceInfo(audioInputDeviceElement.textContent),
      'Active audio output device': parseDeviceInfo(audioOutputInfoElement.textContent),
      'constraints': parseJsonContent(trackConstraintsElement.textContent),
      'MediaStreamTrack settings': parseJsonContent(trackSettingsElement.textContent),
      'MediaStreamTrack properties': parseJsonContent(trackPropertiesElement.textContent),
      'MediaStreamTrackAudioStats': parseJsonContent(trackStatsElement.textContent),
      'RTCOutboundRtpStreamStats': parseJsonContent(outboundRtpStatsElement.textContent),
      'RTCInboundRtpStreamStats': parseJsonContent(inboundRtpStatsElement.textContent),
      'RTCAudioPlayoutStats': parseJsonContent(audioPlayoutStatsElement.textContent),
    };

    // Clean up the snapshot by removing any sections that are empty or null.
    for (const key in snapshot) {
      const value = snapshot[key];
      if (value === null || (typeof value === 'object' && Object.keys(value).length === 0)) {
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

  // Initialize the application by populating devices and then applying URL parameters.
  await populateAudioInputDevices();
  await populateAudioOutputDevices();
  applyUrlParameters();
});