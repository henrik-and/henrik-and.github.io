document.addEventListener('DOMContentLoaded', () => {
  const gumButton = document.getElementById('gum-button');
  const stopButton = document.getElementById('stop-button');
  const echoCancellationSelect = document.getElementById('echoCancellation');
  const autoGainControlSelect = document.getElementById('autoGainControl');
  const noiseSuppressionSelect = document.getElementById('noiseSuppression');
  const errorMessageElement = document.getElementById('error-message');
  const audioDeviceSelect = document.querySelector('#audioDevice');

  let stream = null;

  stopButton.disabled = true;

  async function populateAudioDevices() {
    console.log('Populating audio devices...');
    
    // Check if we have permission to access media devices.
    // If not, the device labels won't be available.
    let devices = await navigator.mediaDevices.enumerateDevices();
    const hasPermissions = devices.every(device => device.label);
    if (!hasPermissions) {
      try {
        // This will trigger a permission prompt.
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        // Stop the tracks immediately since we only needed the permission.
        tempStream.getTracks().forEach(track => track.stop());
        // Re-populate devices now that we have permission and labels.
        devices = await navigator.mediaDevices.enumerateDevices();
      } catch (err) {
        console.error('Error getting media permissions:', err);
        errorMessageElement.textContent = 
            `Error getting permissions: ${err.name} - ${err.message}`;
        errorMessageElement.style.display = 'block';
        // Do not proceed if we can't get permissions.
        return;
      }
    }

    const selectedDeviceId = audioDeviceSelect.value;
    audioDeviceSelect.innerHTML = '';

    const audioDevices = devices.filter(device => device.kind === 'audioinput');

    audioDeviceSelect.appendChild(new Option('default', 'default'));

    audioDevices.forEach((device, index) => {
      // Create a new Option element for the dropdown.
      // The first argument is the visible text, and the second is the actual value.
      // If device.label is empty (e.g., before permissions are granted), a generic name is used.
      const option = new Option(device.label || `Microphone ${index + 1}`, device.deviceId);
      audioDeviceSelect.appendChild(option);
    });

    // Restore the previously selected device if it still exists.
    // This logic handles the case where the list is refreshed (e.g., on
    // devicechange or after the permission is granted). It checks if the device
    // the user had selected before is still in the new list. If it is, it
    // re-selects it for them. This prevents the dropdown from resetting to
    // "default" every time they plug in a new device.
    if ([...audioDeviceSelect.options].some(option => option.value === selectedDeviceId)) {
      audioDeviceSelect.value = selectedDeviceId;
    }
  }

  gumButton.addEventListener('click', async () => {
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
      stream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('getUserMedia() successful');
      const [audioTrack] = stream.getAudioTracks();
      console.log('audioTrack:', audioTrack);
      gumButton.disabled = true;
      stopButton.disabled = false;
      await populateAudioDevices();
    } catch (err) {
      console.error(err);
      errorMessageElement.textContent = `Error: ${err.name} - ${err.message}`;
      errorMessageElement.style.display = 'block';
    }
  });

  stopButton.addEventListener('click', () => {
    if (stream) {
      stream.getTracks().forEach(track => track.stop());
      stream = null;
      gumButton.disabled = false;
      stopButton.disabled = true;
    }
  });

  navigator.mediaDevices.addEventListener('devicechange', populateAudioDevices);
  populateAudioDevices();
});
