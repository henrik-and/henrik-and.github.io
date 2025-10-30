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
  const streamControlsContainer = document.querySelector('#stream-controls-container');
  const muteCheckbox = document.querySelector('#mute-checkbox');
  const playCheckbox = document.querySelector('#play-checkbox');
  const audioPlayback = document.querySelector('#audio-playback');
  const trackSettingsElement = document.querySelector('#track-settings');
  const trackPropertiesElement = document.querySelector('#track-properties');

  let localStream;
  let audioContext;
  let analyser;

  stopButton.disabled = true;

  function setConstraintsDisabled(disabled) {
    echoCancellationSelect.disabled = disabled;
    autoGainControlSelect.disabled = disabled;
    noiseSuppressionSelect.disabled = disabled;
    audioDeviceSelect.disabled = disabled;
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

  // Sets up the Web Audio API to process the audio stream and prepares it for visualization.
  function visualizeAudio(stream) {
    // Stop any previous audio context to prevent multiple contexts from running.
    if (audioContext) {
      audioContext.close();
    }
    // Create a new audio context.
    audioContext = new AudioContext();
    // Create a source node from the media stream.
    const source = audioContext.createMediaStreamSource(stream);
    // Create an analyser node to get frequency data.
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    // Connect the source to the analyser. The analyser does not need to be 
    // connected to a destination to get the data.
    source.connect(analyser);

    // Start the drawing loop.
    drawVisualizer();
  }

  // This function is the core of the visualization. It's a self-contained loop that continuously
  // draws the audio visualization on the canvas.
  function drawVisualizer() {
    // The loop is driven by requestAnimationFrame, which tells the browser to call this function
    // again before the next repaint. The update rate is typically synced with the display's
    // refresh rate, which is usually 60 frames per second (60Hz).

    // If the context is closed (e.g., by the stop button), clear the canvas and 
    // stop the loop.
    if (!audioContext || audioContext.state === 'closed') {
      canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
      return;
    }

    // Request the next frame of the animation.
    requestAnimationFrame(drawVisualizer);

    // Get the frequency data from the analyser.
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    // Calculate the average volume of the audio.
    let sum = dataArray.reduce((a, b) => a + b, 0);
    let average = sum / bufferLength;

    // Draw the visualization on the canvas.
    canvasCtx.fillStyle = 'rgb(250, 250, 250)';
    canvasCtx.fillRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    const barWidth = (average / 255) * visualizerCanvas.width;
    canvasCtx.fillStyle = '#00FF00';
    canvasCtx.fillRect(0, 0, barWidth, visualizerCanvas.height);
  }

  gumButton.addEventListener('click', async () => {
    // Disable the button and constraints immediately to prevent a race condition.
    gumButton.disabled = true;
    setConstraintsDisabled(true);

    errorMessageElement.textContent = '';
    errorMessageElement.style.display = 'none';

    const audioConstraints = {};

    const echoCancellation = echoCancellationSelect.value;
    if (echoCancellation !== 'undefined') {
      if (echoCancellation === 'true') {
        audioConstraints.echoCancellation = true;
      } else if (echoCancellation === 'false') {
        audioConstraints.echoCancellation = false;
      } else {
        audioConstraints.echoCancellation = { exact: echoCancellation };
      }
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
    
    const constraints = {
      audio: audioConstraints,
      video: false
    };

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
        settings.groupId = settings.groupId.substring(0, 8) + '..'
                           + settings.groupId.substring(settings.groupId.length - 8);
      }
      if (settings.deviceId && typeof settings.deviceId === 'string' &&
          settings.deviceId !== 'default') {
        settings.deviceId = settings.deviceId.substring(0, 8) + '..'
                            + settings.deviceId.substring(settings.deviceId.length - 8);
      }
      
      const settingsString = JSON.stringify(settings, null, 2);
      trackSettingsElement.textContent = 'Audio track settings:\n' + settingsString;

      const trackProperties = {
        id: audioTrack.id,
        kind: audioTrack.kind,
        label: audioTrack.label,
        enabled: audioTrack.enabled,
        muted: audioTrack.muted,
        readyState: audioTrack.readyState,
      };
      console.log('MediaStreamTrack:', trackProperties);
      const propertiesString = JSON.stringify(trackProperties, null, 2);
      trackPropertiesElement.textContent = 'MediaStreamTrack:\n' + propertiesString;

      audioTrack.onmute = (event) => {
        console.log('Audio track muted:', event);
      };
      audioTrack.onunmute = (event) => {
        console.log('Audio track unmuted:', event);
      };
      // On success, enable the stop button. The gumButton and constraints remain disabled.
      stopButton.disabled = false;
      streamControlsContainer.style.display = 'flex';
      visualizeAudio(localStream);
      await populateAudioDevices();

      // No autoplay: the audio stream is connected to the audio element,
      // but playback is controlled by the 'Play' checkbox.
      audioPlayback.srcObject = localStream;
      playCheckbox.checked = false;

    } catch (err) {
      console.error(err);
      errorMessageElement.textContent = `Error: ${err.name} - ${err.message}`;
      errorMessageElement.style.display = 'block';
      // If the call fails, re-enable the gumButton and constraints.
      gumButton.disabled = false;
      setConstraintsDisabled(false);
    }
  });

  stopButton.addEventListener('click', () => {
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      localStream = null;
    }
    if (audioContext) {
      audioContext.close();
      audioContext = null;
    }
    canvasCtx.clearRect(0, 0, visualizerCanvas.width, visualizerCanvas.height);
    streamControlsContainer.style.display = 'none';
    gumButton.disabled = false;
    stopButton.disabled = true;
    setConstraintsDisabled(false);
    audioPlayback.pause();
    audioPlayback.srcObject = null;
    muteCheckbox.checked = false;
    playCheckbox.checked = false;
    trackSettingsElement.textContent = '';
    trackPropertiesElement.textContent = '';
    console.log('Stream stopped and visualizer cleared.');
  });

  muteCheckbox.addEventListener('change', () => {
    if (localStream) {
      const audioTrack = localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !muteCheckbox.checked;
        console.log('Audio track enabled:', audioTrack.enabled);
      }
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
      // 1. Check if the setSinkId API is even supported by the browser.
      if (!('sinkId' in audioPlayback)) {
        console.log('Playing on OS default device. (The setSinkId API is not ' +
            'supported in this browser.)');
        return;
      }

      const sinkId = audioPlayback.sinkId;

      // 2. A blank sinkId means it's playing to the default device.
      if (sinkId === "") {
        console.log('Playing on default output device.');
        return;
      }

      // 3. If we have a specific sinkId, let's find its name.
      const devices = await navigator.mediaDevices.enumerateDevices();
      
      // 4. Find the matching 'audiooutput' device.
      const outputDevice = devices.find(
        (device) =>
          device.kind === 'audiooutput' && device.deviceId === sinkId
      );

      if (outputDevice) {
        // 5. Check if the label is available (it's often hidden!)
        if (outputDevice.label) {
          console.log(`Playing on output device: "${outputDevice.label}"`);
        } else {
          // This is the "permission not granted" case.
                    console.log(`Playing on output device with ID: ${sinkId}. (Label is ` +
                        `hidden until microphone permission is granted.)`);
        }
      } else {
        // This is a rare case, but good to handle.
        console.log(`Playing on unknown output device with ID: ${sinkId} ` +
            `(Device not found in list)`);
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