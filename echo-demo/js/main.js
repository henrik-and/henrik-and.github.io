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

import { logi, logw, prettyJson } from './utils.js';

// Set to true when the user has granted user media permissions.
let hasMicrophonePermission = false;
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

const selectors = [audioInputSelect, audioOutputSelect];

const mimeType = 'audio/mp4';

// const styles = window.getComputedStyle(gumButton);
// const fontSize = styles.getPropertyValue('font-size');
// logi('button font-size: ' + fontSize);

const loge = (error) => {
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

function updateSourceLabel(element) {
  // Get the label of the source currently attached to the audio element.
  let source;
  if (element.srcObject && gumStream) {
    const [track] = gumStream.getAudioTracks();
    source = track.label;
  } else if (element.src) {
    source = element.src;
  } else if (element.currentSrc) {
    source = element.currentSrc;
  }
  element.currentSourceLabel = source;
}

/** Extend the audio element with three extra properties. */
function updateAudioElement(element, sinkId, label) {
  updateSourceLabel(element);
  // Extend the audio element with custom properties for logging purposes.
  element.currentSinkId = sinkId;
  element.currentSinkLabel = label;
}

document.addEventListener('DOMContentLoaded', async (event) => {
  await ensureMicrophonePermission();
  await enumerateDevices();
  
  htmlAudio = document.getElementById("html-audio");
  htmlAudio.volume = 0.3;
 
  // Set default sink and source for all audio elements.
  changeAudioOutput();
   
  htmlAudio.addEventListener('play', (event) => {
    logi('<audio> playout starts ' +
      `[source: ${htmlAudio.currentSourceLabel}][sink: ${htmlAudio.currentSinkLabel}]`);
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
  logi('<audio> playout starts ' +
    `[source: ${gumAudio.currentSourceLabel}][sink: ${gumAudio.currentSinkLabel}]`);
});

gumRecordedAudio.addEventListener('play', (event) => {
  logi('<audio> playout starts ' +
    `[source: ${gumRecordedAudio.currentSourceLabel}][sink: ${gumRecordedAudio.currentSinkLabel}]`);
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

/** Ensures that we always start with microphone permission. */
async function ensureMicrophonePermission() {
  const permissionStatus = await navigator.permissions.query({ name: 'microphone' });
  if (permissionStatus.state === 'granted') {
    return;
  }
  try {
    // Call mediaDevices.getUserMedia() to explicitly ask for microphone permissions.
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (stream) {
      const [track] = stream.getAudioTracks();
      track.stop();
    }
  } catch (e) {
    loge(e);
  };
}

function getSelectedDevice(select) {
  const options = select.options;
  if (options.length == 0) {
    return '';
  }
  const deviceLabel = options[options.selectedIndex].label;
  return deviceLabel;
};

/**
 * Enumerate all devices and  deliver results (internally) as `MediaDeviceInfo` objects.
 * TODO: ensure that a device selection is maintained after a device is added or removed.
 */
async function enumerateDevices() {
  logi('enumerateDevices()');
  hasMicrophonePermission = false;
  hasMicrophone = false;
  hasSpeaker = false;
  
  // Store currently selected devices.
  const selectedValues = selectors.map(select => select.value);
  
  try {
    // MediaDevices: enumerateDevices()
    // 
    // Returns an array of `MediaDeviceInfaso` objects. Each object in the array
    // describes one of the available media input and output devices.
    // The order is significant — the default capture devices will be listed first.
    //
    // Other than default devices, only devices for which permission has been granted are "available".
    // 
    // If the media device is an input device, an `InputDeviceInfo` object will be returned instead.
    // See also: https://guidou.github.io/enumdemo4.html
    // Chrome issue: https://g-issues.chromium.org/issues/390333516
    
    const devices = await navigator.mediaDevices.enumerateDevices();
    
    // Filter out array of InputDeviceInfo objects.
    const deviceInfosInput = devices.filter(device => device.kind === 'audioinput');
    // Web applications without permissions can know that there are available devices but they
    // don't get any info about them. Hence, `hasMicrophone` can be set to true even without
    // having the microphone permission.
    // Example for no permission: {deviceId: '', kind: 'audioinput', label: '', groupId: ''}
    hasMicrophone = deviceInfosInput.length > 0;
    // Filter out array of MediaDeviceInfo objects.
    const deviceInfosOutput = devices.filter(device => device.kind === 'audiooutput');
    hasSpeaker = deviceInfosOutput.length > 0;
    logi(deviceInfosInput);
    logi(deviceInfosOutput);
    // Clear all select elements and add the latest input and output devices.
    updateDevices(audioInputSelect, deviceInfosInput);
    updateDevices(audioOutputSelect, deviceInfosOutput);
    
    // Check if any <option> element inside the <select> element has a value matching
    // selectedValues[selectorIndex]. If a match is found, assigns the value to select.value which
    // selects the correct option. This approach ensures that a previously selected device is
    // maintained as selection even after device changes (assuming that the old selection was not
    // removed).
    selectors.forEach((select, selectorIndex) => {
      // The spread operator (...) converts the select.options HTMLCollection into a standard array.
      if ([...select.options].some(option => option.value === selectedValues[selectorIndex])) {
        select.value = selectedValues[selectorIndex];
      }
    });
    
  } catch (e) {
    loge(e);
  }
};

/**
 * Call HTMLMediaElement: setSinkId() on all available audio elements.
 */
async function changeAudioOutput() {
  if (!hasSpeaker) {
    return;
  }
  // Read device ID and device label from the select options.
  const options = audioOutputSelect.options;
  const deviceId = audioOutputSelect.value;
  const deviceLabel = options[options.selectedIndex].label;
  
  // Set sink ID on these three audio elements. 
  const audioElements = [htmlAudio, gumAudio, gumRecordedAudio];
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
    updateAudioElement(element, sinkId, label);
    logi('<audio> playout sets audio output [source: ' +
      `${element.currentSourceLabel}][sink: ${element.currentSinkLabel}]`);
  } catch (e) {
     // Jump back to first output device in the list as it's the default.
     audioOutputSelect.selectedIndex = 0;
    loge(e);
  }
}

async function startGum() {
  logi('startGum()');
  // Get the input device ID based on what is currently selected.
  const audioSource = audioInputSelect.value;
  const audioSink = audioOutputSelect.value;
  // Avoid opening the same device again.
  if (hasMicrophonePermission && openMicId === audioSource) {
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
    updateSourceLabel(gumAudio);
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
    updateSourceLabel(gumAudio);
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
      const superBuffer = new Blob(recordedBlobs, {type: mimeType});
      gumRecordedAudio.src = '';
      gumRecordedAudio.srcObject = null;
      gumRecordedAudio.src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gumRecordedAudio);
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
  const deviceLabel = getSelectedDevice(audioInputSelect);
  logi(`Selected input device: ${deviceLabel}`); 
  // Restart the active stream using the new device selection.
  if (gumStream) {
    await startGum();
  }
};

/** Set sink ID for all audio elements based on the latest output device selection. */
audioOutputSelect.onchange = async () => {
  const deviceLabel = getSelectedDevice(audioOutputSelect);
  logi(`Selected output device: ${deviceLabel}`); 
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



