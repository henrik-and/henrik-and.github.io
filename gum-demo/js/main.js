document.addEventListener('DOMContentLoaded', async () => {
  const gumButton = document.getElementById('gum-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const errorMessageElement = document.getElementById('error-message');
  const audioDeviceSelect = document.querySelector('#audioDevice');
  const audioOutputDeviceSelect = document.querySelector('#audioOutputDevice');
  
  const visualizerCanvas = document.querySelector('#audio-visualizer');
  const canvasCtx = visualizerCanvas.getContext('2d');
  const stopButton = document.querySelector('#stop-button');
  const recordButton = document.querySelector('#record-button');
  const streamControlsContainer = document.querySelector('#stream-controls-container');
  const muteCheckbox = document.querySelector('#mute-checkbox');
  const playCheckbox = document.querySelector('#play-checkbox');
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

  let localStream;
  let audioContext;
  let analyser;
  let isRecording = false;
  let mediaRecorder;
  let recordedChunks = [];
  let recordedAudioContext;
  let recordedAnalyser;
  let recordedSourceNode;
  let recordedVisualizationFrameRequest;
  let statsInterval;
  let previousStats = null;
  let previousTrackProperties = null;

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
    setSelectValue('deviceId', audioDeviceSelect);
    console.log(`applyUrlParameters: echoCancellation from URL is "${params.get('echoCancellation')}"`);
    console.log(`applyUrlParameters: autoGainControl from URL is "${params.get('autoGainControl')}"`);
    console.log(`applyUrlParameters: noiseSuppression from URL is "${params.get('noiseSuppression')}"`);
    console.log(`applyUrlParameters: deviceId from URL is "${params.get('deviceId')}"`);
  }

  function setConstraintsDisabled(disabled) {
    echoCancellationSelect.disabled = disabled;
    autoGainControlSelect.disabled = disabled;
    noiseSuppressionSelect.disabled = disabled;
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

  function visualizeRecordedAudio() {
    if (!recordedAudioContext) {
      recordedAudioContext = new AudioContext();
      const source = recordedAudioContext.createMediaElementSource(recordedAudio);
      recordedAnalyser = recordedAudioContext.createAnalyser();
      recordedAnalyser.fftSize = 16384;
      source.connect(recordedAnalyser);
      recordedAnalyser.connect(recordedAudioContext.destination);
    }
    drawRecordedVisualizer();
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
      const extendedStats = {
        deliveredFrames: currentStats.deliveredFrames,
        totalFrames: currentStats.totalFrames,
        droppedFrames: currentStats.totalFrames - currentStats.deliveredFrames,
      };

      if (previousStats) {
        const deltaStats = {
          deliveredFrames: currentStats.deliveredFrames - previousStats.deliveredFrames,
          totalFrames: currentStats.totalFrames - previousStats.totalFrames,
          droppedFrames: extendedStats.droppedFrames - previousStats.droppedFrames,
        };
        extendedStats.FPS = deltaStats;
      }
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

  gumButton.addEventListener('click', async () => {
    gumButton.disabled = true;
    copyBookmarkButton.disabled = true;
    setConstraintsDisabled(true);
    previousStats = null;
    previousTrackProperties = null;
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
      statsInterval = setInterval(() => updateTrackStats(audioTrack), 1000);
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
      visualizeAudio(localStream);
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

      audioPlayback.srcObject = localStream;
      playCheckbox.checked = false;
      isRecording = false;
      updateRecordButtonUI();
    } catch (err) {
      console.error(err);
      errorMessageElement.textContent = `Error: ${err.name} - ${err.message}`;
      errorMessageElement.style.display = 'block';
      gumButton.disabled = false;
      copyBookmarkButton.disabled = false;
      setConstraintsDisabled(false);
    }
  });

  /**
   * Displays information about the active audio output device.
   * This function reads the `audioPlayback.sinkId` property, which is the browser's
   * source of truth for the currently active audio output device. It then finds the
   * full device details from the enumerated device list to display them. This ensures
   * the displayed information accurately reflects the device in use, not just the
   * selection in the dropdown.
   */
  async function updateAudioOutputInfo() {
    try {
      if (!('sinkId' in audioPlayback)) {
        audioOutputInfoElement.textContent = 'Audio output device selection not supported.';
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const sinkId = audioPlayback.sinkId;
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
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    clearInterval(statsInterval);
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.style.display = 'none';
    audioDevicesContainer.style.display = 'none';
    audioOutputInfoElement.style.display = 'none';
    audioOutputInfoElement.textContent = '';
    gumButton.disabled = false;
    copyBookmarkButton.disabled = false;
    stopButton.disabled = true;
    recordButton.disabled = true;
    setConstraintsDisabled(false);
    audioOutputDeviceSelect.disabled = false;
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    muteCheckbox.checked = false;
    playCheckbox.checked = false;
    trackSettingsElement.textContent = '';
    trackPropertiesElement.textContent = '';
    trackStatsElement.textContent = '';
    trackConstraintsElement.textContent = '';
    audioInputDeviceElement.textContent = '';
    previousStats = null;
    previousTrackProperties = null;
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

  playCheckbox.addEventListener('change', async () => {
    if (localStream) {
      if (playCheckbox.checked) {
        const sinkId = audioOutputDeviceSelect.value;
        try {
          // An empty string sets the output to the user-agent default device.
          const deviceIdToSet = sinkId === 'undefined' ? '' : sinkId;
          await audioPlayback.setSinkId(deviceIdToSet);
          console.log(`Audio output device set to: ${deviceIdToSet || 'default'}`);
          await audioPlayback.play();
          audioOutputDeviceSelect.disabled = true;
        } catch (err) {
          console.error('Error setting audio output device:', err);
          errorMessageElement.textContent = `Error setting sinkId: ${err.name} - ${err.message}`;
          errorMessageElement.style.display = 'block';
          // Revert the UI state since we failed.
          playCheckbox.checked = false;
          audioOutputDeviceSelect.disabled = false;
        }
      } else {
        await audioPlayback.pause();
        audioOutputInfoElement.style.display = 'none';
        audioOutputDeviceSelect.disabled = false;
      }
    }
  });

  audioPlayback.addEventListener('play', async () => {
    console.log('Audio playback started.');
    await updateAudioOutputInfo();
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
        params.set(name, value);latenct
      }
    };

    // Add the current constraint values to the search parameters.
    addParam('echoCancellation', echoCancellationSelect);
    addParam('autoGainControl', autoGainControlSelect);
    addParam('noiseSuppression', noiseSuppressionSelect);
    addParam('deviceId', audioDeviceSelect);

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

  // Initialize the application by populating devices and then applying URL parameters.
  await populateAudioInputDevices();
  await populateAudioOutputDevices();
  applyUrlParameters();
});