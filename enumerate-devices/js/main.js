const deviceList = document.getElementById('device-list');
const audioInputFilter = document.getElementById('audioinput');
const audioOutputFilter = document.getElementById('audiooutput');
const videoInputFilter = document.getElementById('videoinput');
const copyButton = document.getElementById('copy-button');
const refreshButton = document.getElementById('refresh-button');

async function checkAndRequestPermissions() {
    let cameraPermission, microphonePermission;
    try {
        cameraPermission = await navigator.permissions.query({ name: 'camera' });
        microphonePermission = await navigator.permissions.query({ name: 'microphone' });
    } catch (e) {
        console.error("Permissions API not supported, falling back to getUserMedia.", e);
        // Fallback for browsers that don't support the Permissions API.
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            stream.getTracks().forEach(track => track.stop());
        } catch (err) {
            console.error('getUserMedia error:', err);
        }
        return;
    }

    if (cameraPermission.state === 'granted' && microphonePermission.state === 'granted') {
        // Permissions already granted.
        return;
    }

    // If not granted, we need to request them.
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
        stream.getTracks().forEach(track => track.stop());
    } catch (err) {
        console.error('getUserMedia error:', err);
        // We can still proceed, but device labels might be empty.
    }
}

async function enumerateDevices() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
    deviceList.textContent = 'enumerateDevices() not supported.';
    return;
  }

  await checkAndRequestPermissions();

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    deviceList.innerHTML = ''; // Clear previous list

    const filteredDevices = devices.filter(device => {
        return (audioInputFilter.checked && device.kind === 'audioinput') ||
               (audioOutputFilter.checked && device.kind === 'audiooutput') ||
               (videoInputFilter.checked && device.kind === 'videoinput');
    });

    const totalCount = filteredDevices.length;
    const numDigits = String(totalCount).length;
    let count = 1;

    filteredDevices.forEach(device => {
        const line = document.createElement('div');
        line.className = device.kind;
        const countStr = String(count++).padStart(numDigits, ' ');
        line.textContent = `${countStr} [${device.kind}] ${device.label} [${device.deviceId}]`;
        if (device.deviceId === 'default') {
            line.style.fontWeight = 'bold';
        }
        deviceList.appendChild(line);
    });

    if (totalCount === 0) {
        deviceList.textContent = 'No devices found for the selected filter.';
    }

  } catch (err) {
    deviceList.textContent = `Error: ${err.name}: ${err.message}`;
  }
}

function copyToClipboard() {
    const textToCopy = Array.from(deviceList.children).map(child => child.textContent).join('\n');
    navigator.clipboard.writeText(textToCopy).then(() => {
        // visual feedback could be added here
    }).catch(err => {
        console.error('Failed to copy text: ', err);
    });
}

audioInputFilter.addEventListener('change', enumerateDevices);
audioOutputFilter.addEventListener('change', enumerateDevices);
videoInputFilter.addEventListener('change', enumerateDevices);
copyButton.addEventListener('click', copyToClipboard);
refreshButton.addEventListener('click', enumerateDevices);
navigator.mediaDevices.addEventListener('devicechange', enumerateDevices);

// Initial call to populate the list on page load.
enumerateDevices();
