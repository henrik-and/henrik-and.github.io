'use strict';

/**
 * TODO: Ensure that a device selection is maintained after a device is added or removed.
 * TODO: Check that a device can be changed while recording is ongoing.
 */

const audioInputSelect = document.getElementById('audio-input');
const audioOutputSelect = document.getElementById('audio-output');
const gumAudio = document.getElementById('gum-audio');
const gumPlayAudioButton = document.getElementById('gum-play-audio');
const gumRecordedAudio = document.getElementById('gum-recorded-audio');
const gumButton = document.getElementById('gum');
const gumRecordButton = document.getElementById('gum-record');
const gumAecCheckbox = document.getElementById('gum-aec');
const gumStopButton = document.getElementById('gum-stop');
const gumMuteCheckbox = document.getElementById('gum-mute');
const gumConstraintsDiv = document.getElementById('gum-constraints');
const gumTrackDiv = document.getElementById('gum-track');
const gumRecordedDiv = document.getElementById('gum-recorded');
const errorElement = document.getElementById('error-message');

// Set to true when the user has granted user media permissions.
let hasPermission = false;
// Set to true if at least one input device is detected.
let hasMicrophone = false;
// Set to true if at least one output device is detected.
let hasSpeaker = false;
// Contains the currently active microphone device ID.
let openMicId = undefined;
let htmlAudio;
let gumStream;
let mediaRecorder;
let recordedBlobs;

gumStopButton.disabled = true;
gumMuteCheckbox.disabled = true;
gumAecCheckbox.disabled = false;

const mimeType = 'audio/mp4';

const logi = (...args) => {
  console.log(...args);
}

const logw = (...args) => {
  console.warn(...args);
}

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const loge = (error) => {
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

const styles = window.getComputedStyle(gumButton);
const fontSize = styles.getPropertyValue('font-size');
// logi('button font-size: ' + fontSize); 

document.addEventListener('DOMContentLoaded', async (event) => {
  await enumerateDevices();
  
  htmlAudio = document.getElementById("html-audio");
  htmlAudio.volume = 0.3;
  
  htmlAudio.addEventListener('play', (event) => {
    logi(`<audio> HTML audio playout started [source: ${htmlAudio.currentSrc}]`);
  });
  
  htmlAudio.addEventListener('pause', (event) => {
    logi('<audio> HTML audio playout paused');
  });
  
  htmlAudio.addEventListener('ended', (event) => {
    logi('<audio> HTML audio playout ended');
  });
});

function clearGumInfoContainer() {
  const container = document.querySelector('.gum-info-container');
  const divsToClear = container.querySelectorAll('div');
  divsToClear.forEach(div => {
    div.textContent = '';
  });
};

function printAudioSettings(settings) {
  const propertiesToPrint = [
    'deviceId',
    'echoCancellation',
    'autoGainControl',
    'noiseSuppression',
    'sampleRate',
    'voiceIsolation'
  ];

  //  MediaStreamTrack: getSettings is the current configuration of the track's constraints.
  const filteredSettings = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = settings[prop];
    return obj;
  }, {});
  gumConstraintsDiv.textContent = 'Active constraints:\n' + prettyJson(filteredSettings);
  // logi('capabilities:', prettyJson(audioTrack.getCapabilities()));
    
};

function printAudioTrack(track) {
  const propertiesToPrint = [
    'label',
    'id',
    'kind',
    'enabled',
    'muted',
    'readyState'
  ];
  const filteredTrack = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = track[prop];
    return obj;
  }, {});
  gumTrackDiv.textContent = 'MediaStreamTrack:\n' + prettyJson(filteredTrack);
};

function printMediaRecorder(recorder) {
  const propertiesToPrint = [
    'mimeType',
    'state'
  ];
  const filteredRecorder = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = recorder[prop];
    return obj;
  }, {});
  gumRecordedDiv.textContent = 'MediaRecorder:\n' + prettyJson(filteredRecorder);
};

gumAudio.addEventListener('play', (event) => {
  let sourceLabel;
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    sourceLabel = track.label;
  }
  logi(`<audio> gUM audio track playout started [source: ${sourceLabel}]`);
});

gumAudio.addEventListener('pause', (event) => {
  logi('<audio> gUM audio track playout paused');
});

gumAudio.addEventListener('ended', (event) => {
  logi('<audio> gUM audio track playout ended');
});

gumRecordedAudio.addEventListener('play', (event) => {
  logi(`<audio> Recorded gUM audio track playout started [source: ${gumRecordedAudio.currentSrc}]`);
});

gumRecordedAudio.addEventListener('pause', (event) => {
  logi('<audio> Recorded gUM audio track playout paused');
});

gumRecordedAudio.addEventListener('ended', (event) => {
  logi('<audio> Recorded gUM audio track playout ended');
});

gumAudio.addEventListener('error', (event) => {
  let errorMessage = "An error occurred while trying to play the audio.";

  switch (gumAudio.error.code) {
    case gumAudio.error.MEDIA_ERR_ABORTED:
      errorMessage = "Audio playback was aborted.";
      break;
    case gumAudio.error.MEDIA_ERR_NETWORK:
      errorMessage = "A network error occurred.";
      break;
    case gumAudio.error.MEDIA_ERR_DECODE:
      errorMessage = "The audio file could not be decoded.";
      break;
    case gumAudio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
      // Check if the error is specifically due to a 404 (Not Found)
      if (gumAudio.networkState === gumAudio.NETWORK_NO_SOURCE) {
        errorMessage = "The audio file could not be found.";
      } else {
        errorMessage = "The audio source is not supported.";
      } 
      break;
  }
  console.error(errorMessage);
});

function updateDevices(listElement, devices) {
  listElement.innerHTML = '';
  devices.map(device => {
    const deviceOption = document.createElement('option');
    deviceOption.value = device.deviceId;
    deviceOption.label = device.label;
    deviceOption.text = device.label;
    listElement.appendChild(deviceOption);
  });
};

/**
 * Enumerate all devices and  deliver results (internally) as `MediaDeviceInfo` objects.
 * TODO: ensure that a device selection is maintained after a device is added or removed.
 */
async function enumerateDevices() {
  hasPermission = false;
  hasMicrophone = false;
  hasSpeaker = false;
  const audioSelectors = [audioInputSelect, audioOutputSelect];
  logi('Selected input device: ' + audioInputSelect.value);
  
  try {
    // MediaDevices: enumerateDevices()
    // 
    // Returns an array of `MediaDeviceInfo` objects. Each object in the array
    // describes one of the available media input and output devices.
    // The order is significant — the default capture devices will be listed first.
    //
    // Other than default devices, only devices for which permission has been granted are "available".
    // 
    // If the media device is an input device, an `InputDeviceInfo` object will be returned instead.
    // See also: https://guidou.github.io/enumdemo4.html
    // Chrome issue: https://g-issues.chromium.org/issues/390333516
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // If we get at least one deviceId, it means that the user has granted media permissions.
    hasPermission = devices.length > 0;
    // Filter out array of InputDeviceInfo objects.
    const deviceInfosInput = devices.filter(device => device.kind === 'audioinput');
    hasMicrophone = deviceInfosInput.length > 0;
    // Filter out array of MediaDeviceInfo objects.
    const deviceInfosOutput = devices.filter(device => device.kind === 'audiooutput');
    hasSpeaker = deviceInfosOutput.length > 0;
    logi(deviceInfosInput);
    logi(deviceInfosOutput);
    // Clear all select elements and add the latest input and output devices.
    updateDevices(audioInputSelect, deviceInfosInput);
    updateDevices(audioOutputSelect, deviceInfosOutput);
  } catch (e) {
    loge(e);
  }
};

async function changeAudioOutput() {
  if (!hasSpeaker) {
    return;
  }
  const options = audioOutputSelect.options;
  const deviceId = audioOutputSelect.value;
  const deviceLabel = options[options.selectedIndex].label;
  const audioElements = [htmlAudio, gumAudio];
  await Promise.all(audioElements.map(element => attachSinkId(element, deviceId, deviceLabel)));
}

/** 
 * Attach audio output device to audio/video element using device/sink ID.
 * See also https://developer.chrome.com/blog/audiocontext-setsinkid.
 * Demo: https://sinkid.glitch.me/
 */
async function attachSinkId(element, sinkId, label) {
  if (typeof element.sinkId == 'undefined') {
    logw('Browser does not support output device selection.');
    return;
  }
  
  try {
    /**
     * HTMLMediaElement: setSinkId()
     * Set the ID of the audio device to use for output.
     * The output device is set even if the element has no source to prepare for when it gets one.
     */
    await element.setSinkId(sinkId);
    
    let source;
    if (element.srcObject && gumStream) {
      const [track] = gumStream.getAudioTracks();
      source = track.label;
    } else if (element.src) {
      source = element.src;
    } else if (element.currentSrc) {
      source = element.currentSrc;
    }      
    logi(`<audio> audio playout sets audio output [source: ${source}][sink: ${label}]`);
  } catch (e) {
     // Jump back to first output device in the list as it's the default.
     audioOutputSelect.selectedIndex = 0;
    loge(e);
  }
}

async function startGum() {
  logi('startGum()');
  // Get the input device ID based on what is currently selected.
  const audioSource = audioInputSelect.value || undefined;
  const audioSink = audioOutputSelect.value;
  logi(audioSink);
  // Avoid opening the same device again.
  if (hasPermission && openMicId === audioSource) {
    return;
  }
  
  // Close existing streams.
  stopGum();
  
  try {
    // Constraints without any `deviceId` property in the `audio` object.
    let constraints = {
      audio: {
        echoCancellation: {exact: gumAecCheckbox.checked},
        autoGainControl: {exact: true},
        noiseSuppression: {exact: true},
      },
      video: false,
    };
    // Add a `deviceId` property to the `audio` object if a microphone is available.
    if (hasMicrophone) {
      constraints.audio.deviceId = audioSource ? {exact: audioSource} : undefined;
    }
    
    logi('requested constraints to getUserMedia: ', prettyJson(constraints));
    // MediaDevices: getUserMedia()
    gumStream = await navigator.mediaDevices.getUserMedia(constraints);
    const [audioTrack] = gumStream.getAudioTracks();
 
    const settings = audioTrack.getSettings();
    printAudioSettings(settings);
    printAudioTrack(audioTrack);
    // Store the currently selected and active (unique) microphone ID.
    openMicId = settings.deviceId;
     
    audioTrack.onmute = () => {
      logi('MediaStreamTrack.onmute: ' + audioTrack.label);
      printAudioTrack(audioTrack);
    };
    audioTrack.onunmute = () => {
      logi('MediaStreamTrack.onunmute: ' + audioTrack.label);
      printAudioTrack(audioTrack);
    };
    
    // The `autoplay` attribute of the audio tag is not set.
    gumAudio.srcObject = gumStream;
    if (gumPlayAudioButton.checked) {
      await gumAudio.play();
    }
       
    gumButton.disabled = true;
    gumStopButton.disabled = false;
    gumMuteCheckbox.disabled = false;
    gumAecCheckbox.disabled = true;
    gumRecordButton.disabled = false;
  } catch (e) {
    loge(e);
  }
}  

gumButton.onclick = async () => {
  await startGum();
};

function stopGum() {
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    track.stop();
    gumStream = null;
    openMicId = undefined;
    gumAudio.srcObject = null;
    gumButton.disabled = false;
    gumStopButton.disabled = true;
    gumMuteCheckbox.disabled = true;
    gumAecCheckbox.disabled = false;
    gumRecordButton.textContent = 'Start Recording';
    gumRecordButton.disabled = true;
    clearGumInfoContainer();
  }
};

gumStopButton.onclick = () => {
  stopGum();
};

gumMuteCheckbox.onchange = () => {
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    track.enabled = !gumMuteCheckbox.checked;
    printAudioTrack(track);
  }
};

gumPlayAudioButton.onclick = async () => {
  if (gumPlayAudioButton.checked) {
    if (gumAudio.srcObject && gumAudio.paused) {
      await gumAudio.play();
    }
  } else {
    if (gumAudio.srcObject && !gumAudio.paused) {
      await gumAudio.pause();
    }
  }
};

function startRecording() {
  if (!gumStream) {
    return;
  }
  
  gumRecordedAudio.src = '';
  gumRecordedAudio.disabled = true;
  
  recordedBlobs = [];
  const options = {mimeType};
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    console.error(`MediaRecorder does not support mimeType: ${mimeType}`);
    return;
  }
  
  try {
    mediaRecorder = new MediaRecorder(gumStream, options);
    gumRecordButton.textContent = 'Stop Recording';
    
    mediaRecorder.onstart = (event) => {
      printMediaRecorder(mediaRecorder);
    };
    
    mediaRecorder.onstop = (event) => {
      
      gumRecordedAudio.addEventListener('canplay', () => {
        // logi('Recorded audio is now ready to be played out and/or downloaded.');
      });
      
      const superBuffer = new Blob(recordedBlobs, {type: mimeType});
      gumRecordedAudio.src = '';
      gumRecordedAudio.srcObject = null;
      gumRecordedAudio.src = URL.createObjectURL(superBuffer);
      printMediaRecorder(mediaRecorder);
      gumRecordedDiv.textContent += '\nrecorded blob size: ' + superBuffer.size;
    };
    
    mediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedBlobs.push(event.data);
      }
    };
    
    mediaRecorder.start();
  } catch (e) {
    log(e); 
  }
};

function stopRecording() {
  if (mediaRecorder) {
    mediaRecorder.stop();
  }
};

gumRecordButton.onclick = () => {
  if (gumRecordButton.textContent === 'Start Recording') {
    startRecording();
  } else {
    stopRecording();
    gumRecordButton.textContent = 'Start Recording';
  }
};

/** Restart the local MediaStreamTrack (gUM) when a new input device is selected. */
audioInputSelect.onchange = async () => {
  // Restart the active stream using the new device selection.
  if (gumStream) {
    await startGum();
  }
};

audioOutputSelect.onchange = async () => {
  await changeAudioOutput();
};

/** 
 * The devicechange event is sent to a MediaDevices instance whenever a media device such as a
 * camera, microphone, or speaker is connected to or removed from the system.
 */
navigator.mediaDevices.ondevicechange = async () => {
  logw('MediaDevices: devicechange');
  // Refresh the list (and selection) of available devices.
  await enumerateDevices();
  // Restart the active stream using the new device selection.
  if (gumStream) {
    await startGum();
  }
};



