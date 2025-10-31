document.addEventListener('DOMContentLoaded', () => {
  const gumButton = document.getElementById('gum-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const errorMessageElement = document.getElementById('error-message');
  const audioDeviceSelect = document.querySelector('#audioDevice');
  
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
  const recordedAudio = document.querySelector('#recorded-audio');
  const recordedVisualizer = document.querySelector('#recorded-visualizer');
  const highestFreqDisplay = document.querySelector('#highest-freq-display');

  let localStream;
  let audioContext;
  let analyser;
  let isRecording = false;
  let mediaRecorder;
  let recordedChunks = [];
  let recordedAudioContext;
  let recordedAnalyser;
  let maxFrequencyOfRecording = 0;
  let recordedVisualizationFrameRequest;

  stopButton.disabled = true;
  recordButton.disabled = true;

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

  async function populateAudioDevices() {
    console.log('Populating audio devices...');
    
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
    audioDeviceSelect.innerHTML = '';

    const audioDevices = devices.filter(device => device.kind === 'audioinput');

    audioDevices.forEach((device, index) => {
      const option = new Option(device.label || `Microphone ${index + 1}`,
          device.deviceId);
      audioDeviceSelect.appendChild(option);
    });

    if ([...audioDeviceSelect.options].some(option => 
        option.value === selectedDeviceId)) {
      audioDeviceSelect.value = selectedDeviceId;
    }
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
      recordedAnalyser.fftSize = 2048;
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
    const nyquist = recordedAudioContext.sampleRate / 2;
    const highestFrequency = Math.round((maxFreqIndex * nyquist) / bufferLength);
    if (highestFrequency > maxFrequencyOfRecording) {
      maxFrequencyOfRecording = highestFrequency;
    }
    highestFreqDisplay.textContent = `Highest frequency: ${highestFrequency} Hz`;
  }

  gumButton.addEventListener('click', async () => {
    gumButton.disabled = true;
    setConstraintsDisabled(true);
    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';
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
    audioConstraints.deviceId = { exact: audioDeviceSelect.value };
    const constraints = { audio: audioConstraints, video: false };
    console.log('constraints:', JSON.stringify(constraints, null, 2));
    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      localStream = stream;
      console.log('getUserMedia() successful');
      const [audioTrack] = stream.getAudioTracks();
      console.log('audioTrack:', audioTrack);
      const settings = audioTrack.getSettings();
      console.log('Audio track settings:', settings);
      if (settings.groupId && typeof settings.groupId === 'string') {
        settings.groupId = `${settings.groupId.substring(0, 8)}..${settings.groupId.substring(settings.groupId.length - 8)}`;
      }
      if (settings.deviceId && typeof settings.deviceId === 'string' && settings.deviceId !== 'default') {
        settings.deviceId = `${settings.deviceId.substring(0, 8)}..${settings.deviceId.substring(settings.deviceId.length - 8)}`;
      }
      trackSettingsElement.textContent = 'Audio track settings:\n' + JSON.stringify(settings, null, 2);
      const trackProperties = {
        id: audioTrack.id, kind: audioTrack.kind, label: audioTrack.label,
        enabled: audioTrack.enabled, muted: audioTrack.muted, readyState: audioTrack.readyState,
      };
      console.log('MediaStreamTrack:', trackProperties);
      trackPropertiesElement.textContent = 'MediaStreamTrack:\n' + JSON.stringify(trackProperties, null, 2);
      audioTrack.onmute = (event) => console.log('Audio track muted:', event);
      audioTrack.onunmute = (event) => console.log('Audio track unmuted:', event);
      stopButton.disabled = false;
      recordButton.disabled = false;
      streamControlsContainer.style.display = 'flex';
      visualizeAudio(localStream);
      await populateAudioDevices();
      audioPlayback.srcObject = localStream;
      playCheckbox.checked = false;
      isRecording = false;
      updateRecordButtonUI();
    } catch (err) {
      console.error(err);
      errorMessageElement.textContent = `Error: ${err.name} - ${err.message}`;
      errorMessageElement.style.display = 'block';
      gumButton.disabled = false;
      setConstraintsDisabled(false);
    }
  });

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
    if (recordedAudioContext) {
      recordedAudioContext.close();
      recordedAudioContext = null;
    }
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.style.display = 'none';
    gumButton.disabled = false;
    stopButton.disabled = true;
    recordButton.disabled = true;
    setConstraintsDisabled(false);
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    muteCheckbox.checked = false;
    playCheckbox.checked = false;
    trackSettingsElement.textContent = '';
    trackPropertiesElement.textContent = '';
    recordedAudio.style.display = 'none';
    if (recordedAudio.src) {
      URL.revokeObjectURL(recordedAudio.src);
      recordedAudio.src = '';
    }
    recordedVisualizer.style.display = 'none';
    highestFreqDisplay.style.display = 'none';
    isRecording = false;
    updateRecordButtonUI();
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
      highestFreqDisplay.style.display = 'none';
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
      maxFrequencyOfRecording = 0;
      recordedVisualizer.style.display = 'block';
      highestFreqDisplay.style.display = 'block';
      if (!recordedAudioContext) {
        recordedAudioContext = new AudioContext();
        const source = recordedAudioContext.createMediaElementSource(recordedAudio);
        recordedAnalyser = recordedAudioContext.createAnalyser();
        recordedAnalyser.fftSize = 2048;
        source.connect(recordedAnalyser);
        recordedAnalyser.connect(recordedAudioContext.destination);
      }
      drawRecordedVisualizer();
    } catch (err) {
      console.error('Error visualizing recorded audio:', err);
      errorMessageElement.textContent = `Visualization Error: ${err.message}`;
      errorMessageElement.style.display = 'block';
    }
  });

  function stopRecordedVisualization() {
    cancelAnimationFrame(recordedVisualizationFrameRequest);
    highestFreqDisplay.textContent = `Maximum frequency: ${maxFrequencyOfRecording} Hz`;
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
      localStream.getAudioTracks()[0].enabled = !muteCheckbox.checked;
    }
  });

  playCheckbox.addEventListener('change', async () => {
    if (localStream) {
      if (playCheckbox.checked) {
        await audioPlayback.play();
      } else {
        await audioPlayback.pause();
      }
    }
  });

  audioPlayback.addEventListener('play', async () => {
    console.log('Audio playback started.');
    try {
      if (!('sinkId' in audioPlayback)) {
        console.log('Playing on OS default device (setSinkId API not supported).');
        return;
      }
      const sinkId = audioPlayback.sinkId;
      if (sinkId === "") {
        console.log('Playing on default output device.');
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const outputDevice = devices.find(d => d.kind === 'audiooutput' && d.deviceId === sinkId);
      if (outputDevice) {
        console.log(`Playing on output device: "${outputDevice.label || 'Label hidden'}"`);
      } else {
        console.log(`Playing on unknown output device with ID: ${sinkId}`);
      }
    } catch (err) {
      console.error('Error getting output device info:', err);
    }
  });

  audioPlayback.addEventListener('pause', () => {
    console.log('Audio playback paused.');
  });

  navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);
  populateAudioDevices();
});