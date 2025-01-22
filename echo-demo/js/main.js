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
const gdmOptionsDiv = document.getElementById('gdm-options');
const gdmTrackDiv = document.getElementById('gdm-track');
const webAudioButton = document.getElementById('web-audio-start-stop');
const gdmButton = document.getElementById('gdm');
const gdmAecCheckbox = document.getElementById('gdm-aec');
const gdmLocalAudioPlaybackCheckbox = document.getElementById('gdm-local-audio-playback');
const gdmSystemAudioCheckbox = document.getElementById('gdm-system-audio');
const gdmStopButton = document.getElementById('gdm-stop');
const gdmMuteCheckbox = document.getElementById('gdm-mute');
const gdmAudio = document.getElementById('gdm-audio');
const gdmPlayAudioButton = document.getElementById('gdm-play-audio');
const gdmRecordedAudio = document.getElementById('gdm-recorded-audio');
const gdmRecordButton = document.getElementById('gdm-record');
const gdmRecordedDiv = document.getElementById('gdm-recorded');
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
let audioContext;
let webAudioElement;
let mediaElementSource;
let gumStream;
let gdmStream;
let gumMediaRecorder;
let gumRecordedBlobs;
let gdmMediaRecorder;
let gdmRecordedBlobs;

gumStopButton.disabled = true;
gdmStopButton.disabled = true;
gumMuteCheckbox.disabled = true;
gumAecCheckbox.disabled = false;
gdmAecCheckbox.disabled = false;
gdmLocalAudioPlaybackCheckbox.disabled = false;
gdmSystemAudioCheckbox.disabled = false;
gdmMuteCheckbox.disabled = true;

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
  const stream = (element.tag === 'gUM' ? gumStream : gdmStream);
  // Get the label of the source currently attached to the audio element.
  let source;
  if (element.srcObject && stream) {
    const [track] = stream.getAudioTracks();
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

function initWebAudio() {
  try {
    webAudioElement = document.getElementById('webaudio-audio');
    webAudioElement.volume = 0.7;
    
    webAudioElement.addEventListener('canplay', (event) => {
    });
    
    // Resume the audio context and start playing audio when play is pressed in the audio control. 
    webAudioElement.addEventListener('play', async (event) => {
      if (!audioContext) {
        // Context must be resumed (or created) after a user gesture on the page.
        audioContext = new AudioContext();
        // When we create a media element source, the Web Audio API takes over the audio routing,
        // meaning the audio now flows through the processing graph.
        mediaElementSource = audioContext.createMediaElementSource(webAudioElement);
        mediaElementSource.connect(audioContext.destination);
        
        const deviceId = audioOutputSelect.value;
        // Avoid explicitly setting `default` as sink ID since it is not supported on all browsers.
        if (deviceId !== 'default') {
        await audioContext.setSinkId(deviceId);
          logi('[WebAudio] playout sets audio ouput ' +
            `[source: ${webAudioElement.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
        }
      }
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      logi('[WebAudio] playout starts ' +
          `[source: ${webAudioElement.currentSrc}][sink: sink: ${getSelectedDevice(audioOutputSelect)}]`);
    });
    
    // Suspend the audio context and stop playing audio when pause is pressed in the audio control.
    webAudioElement.addEventListener('pause', async (event) => {
      if (audioContext.state === 'running') {
        await audioContext.suspend();
      };
    });
  } catch (e) {
    loge(e);
  };
};

document.addEventListener('DOMContentLoaded', async (event) => {
  await ensureMicrophonePermission();
  await enumerateDevices();
    
  htmlAudio = document.getElementById('html-audio');
  htmlAudio.volume = 0.3;
  htmlAudio.tag = 'HTML';
   
  htmlAudio.addEventListener('play', (event) => {
    logi('<audio> playout starts ' +
      `[source: ${htmlAudio.currentSourceLabel}][sink: ${htmlAudio.currentSinkLabel}]`);
  });
  
  await initWebAudio();
  
  [gumAudio, gumRecordedAudio].forEach((element) => {
    element.tag = 'gUM';
  });
  [gdm].forEach((element) => {
    element.tag = 'gDM';
  });

  
  // Set default sink and source for all audio elements and the audio context.
  changeAudioOutput();
});

function clearGumInfoContainer() {
  const container = document.querySelector('.gum-info-container');
  const divsToClear = container.querySelectorAll('div');
  divsToClear.forEach(div => {
    div.textContent = '';
  });
};

function clearGdmInfoContainer() {
  const container = document.querySelector('.gdm-info-container');
  const divsToClear = container.querySelectorAll('div');
  divsToClear.forEach(div => {
    div.textContent = '';
  });
};

function printGumAudioSettings(settings) {
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
  gumConstraintsDiv.textContent = '[gUM] Active constraints:\n' + prettyJson(filteredSettings);
  // logi('capabilities:', prettyJson(audioTrack.getCapabilities()));    
};

/**
 * TODO: figure out why MediaStreamTrack: getSettings() does not include `systemAudio`.
 * Note that the track will have "label: 'System Audio'" when sharing the screen.
 */
function printGdmAudioSettings(settings, systemAudio) {
  const propertiesToPrint = [
    'deviceId',
    'suppressLocalAudioPlayback',
    'echoCancellation',
    'autoGainControl',
    'noiseSuppression',
    'sampleRate',
    'voiceIsolation'
  ];

  //  MediaStreamTrack: getSettings is the current configuration of the track's constraints.
  let filteredSettings = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = settings[prop];
    return obj;
  }, {});
  // Adding `systemAudio` manually from the supplied options.
  filteredSettings.systemAudio = systemAudio;
  gdmOptionsDiv.textContent = '[gDM] Active options:\n' + prettyJson(filteredSettings);    
};

function printGumAudioTrack(track) {
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
  gumTrackDiv.textContent = '[gUM] MediaStreamTrack:\n' + prettyJson(filteredTrack);
};

function printGdmAudioTrack(track) {
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
  gdmTrackDiv.textContent = '[gDM] MediaStreamTrack:\n' + prettyJson(filteredTrack);
};

function printGumMediaRecorder(recorder) {
  const propertiesToPrint = [
    'mimeType',
    'state'
  ];
  const filteredRecorder = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = recorder[prop];
    return obj;
  }, {});
  gumRecordedDiv.textContent = '[gUM] MediaRecorder:\n' + prettyJson(filteredRecorder);
};

function printGdmMediaRecorder(recorder) {
  const propertiesToPrint = [
    'mimeType',
    'state'
  ];
  const filteredRecorder = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = recorder[prop];
    return obj;
  }, {});
  gdmRecordedDiv.textContent = '[gDM] MediaRecorder:\n' + prettyJson(filteredRecorder);
};

gumAudio.addEventListener('play', (event) => {
  logi('<audio> playout starts ' +
    `[source: ${gumAudio.currentSourceLabel}][sink: ${gumAudio.currentSinkLabel}]`);
});

gumAudio.addEventListener('pause', (event) => {
  logi('<audio> playout stops ' +
    `[source: ${gumAudio.currentSourceLabel}][sink: ${gumAudio.currentSinkLabel}]`);
});

gumRecordedAudio.addEventListener('play', (event) => {
  logi('<audio> playout starts ' +
    `[source: ${gumRecordedAudio.currentSourceLabel}][sink: ${gumRecordedAudio.currentSinkLabel}]`);
});

gdmAudio.addEventListener('play', (event) => {
  logi('<audio> playout starts ' +
    `[source: ${gdmAudio.currentSourceLabel}][sink: ${gdmAudio.currentSinkLabel}]`);
});

gdmAudio.addEventListener('pause', (event) => {
  logi('<audio> playout stops ' +
    `[source: ${gdmAudio.currentSourceLabel}][sink: ${gdmAudio.currentSinkLabel}]`);
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
  
  // Set sink ID on these four audio elements. 
  const audioElements = [htmlAudio, gumAudio, gumRecordedAudio, gdmAudio];
  await Promise.all(audioElements.map(element => attachSinkId(element, deviceId, deviceLabel)));
  if (audioContext) {
    // await audioCtx.setSinkId({ type : 'none' });
    if (deviceId !== 'default') {
      await audioContext.setSinkId(deviceId);
      logi('[WebAudio] playout sets audio ouput ' +
        `[source: ${webAudioElement.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
    }
  }
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
    printGumAudioSettings(settings);
    printGumAudioTrack(audioTrack);
    // Store the currently selected and active (unique) microphone ID.
    openMicId = settings.deviceId;
     
    audioTrack.onmute = (event) => {
      logi('[gUM] MediaStreamTrack.onunmute: ' + audioTrack.label);
      printGdmAudioTrack(audioTrack);
    }
    audioTrack.onunmute = (event) => {
      logi('[gUM] MediaStreamTrack.onunmute: ' + audioTrack.label);
      printGdmAudioTrack(audioTrack);
    };
    audioTrack.addEventListener('ended', () => {
      logi('[gUM] MediaStreamTrack.ended: ' + audioTrack.label);
      stopGdm();
    });
    
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
    printGumAudioTrack(track);
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

function startGumRecording() {
  if (!gumStream) {
    return;
  }
  
  gumRecordedAudio.src = '';
  gumRecordedAudio.disabled = true;
  
  gumRecordedBlobs = [];
  const options = {mimeType};
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    console.error(`MediaRecorder does not support mimeType: ${mimeType}`);
    return;
  }
  
  try {
    gumMediaRecorder = new MediaRecorder(gumStream, options);
    gumRecordButton.textContent = 'Stop Recording';
    
    gumMediaRecorder.onstart = (event) => {
      printGumMediaRecorder(gumMediaRecorder);
    };
    
    gumMediaRecorder.onstop = (event) => {
      const superBuffer = new Blob(gumRecordedBlobs, {type: mimeType});
      gumRecordedAudio.src = '';
      gumRecordedAudio.srcObject = null;
      gumRecordedAudio.src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gumRecordedAudio);
      printGumMediaRecorder(gumMediaRecorder);
      gumRecordedDiv.textContent += '\nrecorded blob size: ' + superBuffer.size;
    };
    
    gumMediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        gumRecordedBlobs.push(event.data);
      }
    };
    
    gumMediaRecorder.start();
  } catch (e) {
    log(e); 
  }
};

function stopGumRecording() {
  if (gumMediaRecorder) {
    gumMediaRecorder.stop();
  }
};

gumRecordButton.onclick = () => {
  if (gumRecordButton.textContent === 'Start Recording') {
    startGumRecording();
  } else {
    stopGumRecording();
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

function startGdmRecording() {
  if (!gdmStream) {
    return;
  }
  
  gdmRecordedAudio.src = '';
  gdmRecordedAudio.disabled = true;
  
  gdmRecordedBlobs = [];
  const options = {mimeType};
  if (!MediaRecorder.isTypeSupported(mimeType)) {
    console.error(`MediaRecorder does not support mimeType: ${mimeType}`);
    return;
  }
  
  try {
    // Start by cutting out the audio track part of the `gdmStream`.
    const [audioTrack] = gdmStream.getAudioTracks();
    // Next, create a new MediaStream which only contains the gDM audio track
    const gdmAudioOnlyStream = new MediaStream([audioTrack])
    // Now we can create a MediaRecorder which records audio only.
    gdmMediaRecorder = new MediaRecorder(gdmAudioOnlyStream, options);
    gdmRecordButton.textContent = 'Stop Recording';
    
    gdmMediaRecorder.onstart = (event) => {
      printGdmMediaRecorder(gdmMediaRecorder);
    };
    
    gdmMediaRecorder.onstop = (event) => {
      const superBuffer = new Blob(gdmRecordedBlobs, {type: mimeType});
      gdmRecordedAudio.src = '';
      gdmRecordedAudio.srcObject = null;
      gdmRecordedAudio.src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gdmRecordedAudio);
      printGdmMediaRecorder(gdmMediaRecorder);
      gdmRecordedDiv.textContent += '\nrecorded blob size: ' + superBuffer.size;
    };
    
    gdmMediaRecorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        gdmRecordedBlobs.push(event.data);
      }
    };
    
    gdmMediaRecorder.start();
  } catch (e) {
    loge(e); 
  }
};

function stopGdmRecording() {
  if (gdmMediaRecorder) {
    gdmMediaRecorder.stop();
  }
};

gdmRecordButton.onclick = () => {
  if (gdmRecordButton.textContent === 'Start Recording') {
    startGdmRecording();
  } else {
    stopGdmRecording();
    gdmRecordButton.textContent = 'Start Recording';
  }
};

/**
 * startGdm()
 */
async function startGdm() {
  logi('startGum()');

  // Close existing streams.
  stopGdm();
  
  /** 
   * MediaDevices: getDisplayMedia(options)
   *   audio.suppressLocalAudioPlayback = true => device_id	"loopbackWithMute"
   *   audio.suppressLocalAudioPlayback = false => device_id	"loopback"
   *   systemAudio = 'include' => "Also share system audio" in picker
   *   systemAudio = 'exlude' => Audio sharing option in picker is disabled
   * TypeError is thown if the specified options include values that are not permitted.
   * For example a video property set to false, or if any specified MediaTrackConstraints are not
     permitted. min and exact values are not permitted in constraints used in getDisplayMedia() calls.
   * https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#instance_properties_of_shared_screen_tracks
   * See https://screen-sharing-controls.glitch.me/ for an example.
   * See also https://developer.chrome.com/docs/web-platform/screen-sharing-controls/.
   */
  try {
    let options = {
      video: true,
      audio: {
        echoCancellation: gdmAecCheckbox.checked,
        suppressLocalAudioPlayback: !gdmLocalAudioPlaybackCheckbox.checked,
      },
      systemAudio: (gdmSystemAudioCheckbox.checked ? 'include' : 'exclude'),
      selfBrowserSurface: 'include',
      monitorTypeSurfaces: 'include',
    };
    logi('requested options to getDisplayMedia: ', prettyJson(options));
    
    /** 
     * MediaDevices: getDisplayMedia()
     */
    gdmStream = await navigator.mediaDevices.getDisplayMedia(options);
    const [audioTrack] = gdmStream.getAudioTracks();
    const settings = audioTrack.getSettings();
    printGdmAudioSettings(settings, options.systemAudio);
    printGdmAudioTrack(audioTrack);
    
    audioTrack.onmute = (event) => {
      logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
      printGdmAudioTrack(audioTrack);
    }
    audioTrack.onunmute = (event) => {
      logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
      printGdmAudioTrack(audioTrack);
    };
    audioTrack.addEventListener('ended', () => {
      logi('[gDM] MediaStreamTrack.ended: ' + audioTrack.label);
      stopGdm();
    });
    
    // The `autoplay` attribute of the audio tag is not set.
    gdmAudio.srcObject = gdmStream;
    updateSourceLabel(gdmAudio);
    if (gdmPlayAudioButton.checked) {
      await gdmAudio.play();
    }
    
    gdmButton.disabled = true;
    gdmStopButton.disabled = false;
    gdmAecCheckbox.disabled = true;
    gdmLocalAudioPlaybackCheckbox.disabled = true;
    gdmSystemAudioCheckbox.disabled = true;
    gdmMuteCheckbox.disabled = false;
    gdmRecordButton.disabled = false;
  } catch (e) {
    loge(e);
  }
}  

gdmButton.onclick = async () => {
  await startGdm();
};

function stopGdm() {
  if (gdmStream) {
    const [track] = gdmStream.getAudioTracks();
    track.stop();
    gdmStream = null;
    gdmAudio.srcObject = null;
    gdmButton.disabled = false;
    gdmStopButton.disabled = true;
    gdmAecCheckbox.disabled = false;
    gdmLocalAudioPlaybackCheckbox.disabled = false;
    gdmSystemAudioCheckbox.disabled = false;
    gdmMuteCheckbox.disabled = true;
    gdmRecordButton.textContent = 'Start Recording';
    gdmRecordButton.disabled = true;
    clearGdmInfoContainer();
    updateSourceLabel(gdmAudio);
  }
};

gdmStopButton.onclick = () => {
  stopGdm();
};

gdmMuteCheckbox.onclick = () => {
  if (gdmStream) {
    const [track] = gdmStream.getAudioTracks();
    track.enabled = !gdmMuteCheckbox.checked;
    printGdmAudioTrack(track);
  }
};

gdmPlayAudioButton.onclick = async () => {
  if (gdmPlayAudioButton.checked) {
    if (gdmAudio.srcObject && gdmAudio.paused) {
      await gdmAudio.play();
    }
  } else {
    if (gdmAudio.srcObject && !gdmAudio.paused) {
      await gdmAudio.pause();
    }
  }
};


