'use strict';

/**
 * TODO: Ensure that a device selection is maintained after a device is added or removed.
 * TODO: Check that a device can be changed while recording is ongoing.
 */

const audioInputSelect = document.getElementById('audio-input');
const audioOutputSelect = document.getElementById('audio-output');
const gumAudios = document.querySelectorAll('.gum-audio');
const gumPlayAudioCheckboxes = document.querySelectorAll('.gum-play-audio');
const gumPlayAudioContextCheckboxes = document.querySelectorAll('.gum-play-audio-context');
const gumRecordedAudios = document.querySelectorAll('.gum-recorded-audio');
const gumButtons = document.querySelectorAll('.gum');
const gumRecordButtons = document.querySelectorAll('.gum-record');
const gumDefaultConstraintsCheckbox = document.getElementById('gum-default-constraints');
const gumAecSelect = document.getElementById('gum-aec');
const gumNsCheckbox = document.getElementById('gum-ns');
const gumAgcCheckbox = document.getElementById('gum-agc');
const gumStopButtons = document.querySelectorAll('.gum-stop');
const gumMuteCheckboxes = document.querySelectorAll('.gum-mute');
const gumRequestedConstraintsDivs = document.querySelectorAll('.gum-requested-constraints');
const gumConstraintsDivs = document.querySelectorAll('.gum-constraints');
const gumTrackDivs = document.querySelectorAll('.gum-track');
const gumRecordedDivs = document.querySelectorAll('.gum-recorded');
const gdmOptionsDiv = document.getElementById('gdm-options');
const gdmTrackDiv = document.getElementById('gdm-track');
const webAudioButton = document.getElementById('web-audio-start-stop');
const gdmButton = document.getElementById('gdm');
const gdmAecCheckbox = document.getElementById('gdm-aec');
const gdmNsCheckbox = document.getElementById('gdm-ns');
const gdmAgcCheckbox = document.getElementById('gdm-agc');
const gdmLocalAudioPlaybackCheckbox = document.getElementById('gdm-local-audio-playback');
const gdmSystemAudioCheckbox = document.getElementById('gdm-system-audio');
const gdmWindowAudioSelect = document.getElementById('gdm-window-audio');
const gdmRestrictOwnAudioCheckbox = document.getElementById('gdm-restrict-own-audio');
const gdmPreferCurrentTabCheckbox = document.getElementById('gdm-prefer-current-tab');
const gdmDefaultOptionsCheckbox = document.getElementById('gdm-default-options');
const gdmStopButton = document.getElementById('gdm-stop');
const gdmMuteCheckbox = document.getElementById('gdm-mute');
const gdmAudio = document.getElementById('gdm-audio');
const gdmPlayAudioButton = document.getElementById('gdm-play-audio');
const gdmRecordedAudio = document.getElementById('gdm-recorded-audio');
const gdmRecordButton = document.getElementById('gdm-record');
const gdmRecordedDiv = document.getElementById('gdm-recorded');
const errorElement = document.getElementById('error-message');
const warningElement = document.getElementById('warning-message');
const gumCanvases = document.querySelectorAll('.gum-level-meter');
const gdmCanvas = document.getElementById('gdm-level-meter');
const pcAudio = document.getElementById('pc-audio-destination');
const audioInputInfoDiv = document.getElementById('audio-input-info');
const audioOutputInfoDiv = document.getElementById('audio-output-info');

import { logi, prettyJson } from './utils.js';

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
let pcAudioSource;
let pcMediaElementSource;
let pcMediaSourceDestination;
let mediaElementSource;
// Index 0 <=> gUM with audio processing.
// Index 1 <=> gUM without audio processing.
let gumStreams = [null, null];
let mediaStreamSources = [null, null];
let gdmStream;
let pcLocalStream;
let pcRemoteStream;
let gumMediaRecorders = [null, null];
let gumRecordedBlobs = [null, null];
let gdmMediaRecorder;
let gdmRecordedBlobs;
let gumAnimationFrameId = [null, null];
let gdmAnimationFrameId;

let remoteStreamReady;

let pc1;
let pc2;

gumStopButtons.forEach((button) => {
  button.disabled = true;
});
gdmStopButton.disabled = true;
gumMuteCheckboxes.forEach((checkbox) => {
  checkbox.disabled = true;
});
gumAecSelect.disabled = false;
gumNsCheckbox.disabled = false;
gumAgcCheckbox.disabled = false;
gdmMuteCheckbox.disabled = false;
gdmAecCheckbox.disabled = false;
gdmNsCheckbox.disabled = false;
gdmAgcCheckbox.disabled = false;
gdmLocalAudioPlaybackCheckbox.disabled = false;
gdmSystemAudioCheckbox.disabled = false;
gdmWindowAudioSelect.disabled = false;
gdmRestrictOwnAudioCheckbox.disabled = false;
gdmPreferCurrentTabCheckbox.disabled = false;

const selectors = [audioInputSelect, audioOutputSelect];

// const styles = window.getComputedStyle(gumButton);
// const fontSize = styles.getPropertyValue('font-size');
// logi('button font-size: ' + fontSize);


class TrackedAudioContext extends AudioContext {
  constructor() {
    super();
    this.activeConnections = 0;
  }

  trackConnect(source, destination) {
    source.connect(destination);
    this.activeConnections++;
    console.log(`[WebAudio] Connected: ${this.activeConnections} active sources`);
  }

  trackDisconnect(source, destination) {
    source.disconnect(destination);
    this.activeConnections = Math.max(0, this.activeConnections - 1);
    console.log(`[WebAudio] Disconnected: ${this.activeConnections} active sources`);

    // Automatically suspend when no sources are active
    // if (this.activeConnections === 0) {
    //  this.suspend().then(() => console.log("AudioContext suspended"));
    // }
  }
}

const loge = (error) => {
  if (typeof error === 'object' && error !== null && 'name' in error && 'message' in error) {
    if (error.name === 'OverconstrainedError') {
      errorElement.textContent = `DOMException: ${error.name} [${error.constraint}]`;
    } else {
      errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
    }
  } else {
    errorElement.textContent = error === '' ? '' : `ERROR: ${error}`;
  }
  if (error !== '') {
    console.error(error);
  }
};

const logw = (warning) => {
  warningElement.textContent = warning === '' ? '' : `WARNING: ${warning}`;
  if (warning !== '') {
    console.warn(warning);
  }
};

function getSupportedMimeType() {
  const mimeTypes = [
    'audio/webm; codecs=pcm',
    'audio/webm; codecs=opus',
    'audio/webm',
    'audio/ogg; codecs=opus',
    'audio/ogg',
  ];

  for (const mimeType of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType;
    }
  }

  return null; // No supported mimeType found
}

function updateSourceLabel(element) {
  let stream;
  if (element.tag === 'gUM') {
    // Convert gumAudios NodeList to an array.
    const gumAudiosArray = Array.from(gumAudios); 
    // Find the corresponding stream in gumStreams based on the element's index in gumAudios.
    const index = gumAudiosArray.indexOf(element); 
    stream = gumStreams[index]; 
  } else if (element.tag === 'gDM') {
    stream = gdmStream;
  } else {
    stream = pcRemoteStream;
  }
  
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

/**
 * Creates a WebAudio context and plays audio with a MediaElementAudioSourceNode as source.
 */
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
      }
      
      if (mediaElementSource) {
        // if (audioContext.state === 'suspended') {
        //  await audioContext.resume();
        // }
        return;
      }
      
      // The MediaElementAudioSourceNode interface represents an audio source consisting of an
      // HTML <audio> or <video> element. It is an AudioNode that acts as an audio source.
      // When we create a media element source, the Web Audio API takes over the audio routing,
      // meaning the audio now flows through the processing graph.
      mediaElementSource = audioContext.createMediaElementSource(webAudioElement);
      mediaElementSource.connect(audioContext.destination);
      
      const deviceId = audioOutputSelect.value;
      if ('setSinkId' in audioContext) {
        // Avoid explicitly setting `default` as sink ID since it is not supported on all browsers.
        if (deviceId !== 'default') {
        await audioContext.setSinkId(deviceId);
          logi('[WebAudio] playout sets audio ouput ' +
            `[source: ${webAudioElement.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
        }
      } else {
        logw('AudioContext.setSinkId is not supported');
      }
      logi('[WebAudio] playout starts ' +
          `[source: ${webAudioElement.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
    });
    
    // Suspend the audio context and stop playing audio when pause is pressed in the audio control.
    webAudioElement.addEventListener('pause', async (event) => {
      //if (audioContext.state === 'running') {
      //  await audioContext.suspend();
      //};
    });
  } catch (e) {
    loge(e);
  };
};

const insertStereoSupportForOpus = (sdp) => {
  // Early exit if Opus codec is not present
  if (!sdp.includes("a=rtpmap:111 opus/48000")) {
    logw("Opus codec (111) not found in SDP. Stereo support not added.");
    return sdp;
  }
  
  // Split SDP into lines
  const lines = sdp.split('\r\n');

  // Map through each line, find the target line, and append stereo support.
  const newSdp = lines.map((line) => {
    if (line.startsWith("a=fmtp:111")) {
      if (!line.includes("stereo=1")) {
        return `${line};stereo=1`;
      }
    }
    return line;
  });

  // Join the lines back into a string with proper line breaks.
  return newSdp.join("\r\n");
};

function stopPeerConnectionAudio() {
  closePeerConnection();
  if (pcLocalStream) {
    pcLocalStream.getTracks().forEach(track => track.stop());
    pcLocalStream = null;
  }
  if (pcRemoteStream) {
    pcRemoteStream.getTracks().forEach(track => track.stop());
    pcRemoteStream = null;
  }
  pcAudio.srcObject = null;
  
  if (pcMediaElementSource) {
    pcMediaElementSource.disconnect();
    logi(pcMediaElementSource);
  }
  pcMediaElementSource = null;
  pcMediaSourceDestination = null;
}

const setupPeerConnection = async () => {
  pc1 = new RTCPeerConnection();
  pc2 = new RTCPeerConnection();
  const [localTrack] = pcLocalStream.getAudioTracks();
  let remoteTrack = null;
   
  pc1.addTrack(localTrack, pcLocalStream);
  
  remoteStreamReady = new Promise((resolve) => {
    pc2.ontrack = (e) => {
      [pcRemoteStream] = e.streams;
      resolve(pcRemoteStream);
    };
  });
  
  exchangeIceCandidates(pc1, pc2);
  
  pc1.oniceconnectionstatechange = (e) => {
    // logi('pc1 ICE state: ' + pc1.iceConnectionState)
  }
  
  pc2.oniceconnectionstatechange = (e) => {
    // logi('pc2 ICE state: ' + pc2.iceConnectionState)
  }
  
  const offer = await pc1.createOffer();
  await pc1.setLocalDescription(offer);
  await pc2.setRemoteDescription(offer);
  logi('pc1 offer: ', offer.sdp);
  
  const answer = await pc2.createAnswer();
  answer.sdp = insertStereoSupportForOpus(answer.sdp);
  await pc2.setLocalDescription(answer);
  await pc1.setRemoteDescription(answer);
  console.log('pc2 answer: ', answer.sdp);
};

const closePeerConnection = () => {
  if (pc1) {
    pc1.close();
    pc1 = null;
  }
  if (pc2) {
    pc2.close();
    pc2 = null;
  }
};

const exchangeIceCandidates = (pc1, pc2) => {
  function doExchange(localPc, remotePc) {
    localPc.addEventListener('icecandidate', event => {
      const { candidate } = event;
      if (candidate && remotePc.signalingState !== 'closed') {
        remotePc.addIceCandidate(candidate);
      }
    });
  }
  doExchange(pc1, pc2);
  doExchange(pc2, pc1);
};

/**
 * Uses the captureStream() method of the HTMLMediaElement to returns a MediaStream object which
 * then streams a real-time capture of the content being rendered in the media element.
 */
async function initPeerConnectionAudio() {
  try {
    pcAudioSource = document.getElementById('pc-audio-source');
    
    pcAudioSource.addEventListener('play', async (event) => {
      if (!audioContext) {
        audioContext = new AudioContext();
      }
      
      if (pcMediaElementSource) {
        // Update logs if a new file is now playing
        logi('[PeerConnection] playout starts ' +
          `[source: ${pcAudioSource.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
        return;
      }

      // Note: As a consequence of calling createMediaElementSource(), audio playback from the
      // HTMLMediaElement will be re-routed into the processing graph of the AudioContext.
      // So playing/pausing the media can still be done through the media element API and the player
      // controls.
      // https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/createMediaElementSource
      pcMediaElementSource = audioContext.createMediaElementSource(pcAudioSource);
      
      pcMediaSourceDestination = audioContext.createMediaStreamDestination();
      pcMediaElementSource.connect(pcMediaSourceDestination);
      pcLocalStream = pcMediaSourceDestination.stream;
      
      await setupPeerConnection();
      await remoteStreamReady;
      
      pcAudio.srcObject = pcRemoteStream;
      updateSourceLabel(pcAudio);
       
      logi('[PeerConnection] playout starts ' +
          `[source: ${pcAudioSource.currentSrc}][sink: ${getSelectedDevice(audioOutputSelect)}]`);
    });
    
    // Event listener to update audio source when the selection changes
    document.getElementById('pc-audio-file-select').addEventListener('change', async (event) => {
      const selectedFile = document.getElementById('pc-audio-file-select').value;
      
      const wasPlaying = !pcAudioSource.paused && pcAudioSource.currentTime > 0;
      logi('Audio was playing before change: ', wasPlaying);
      
      pcAudioSource.src = selectedFile;
      
      async function playWhenReady() {
        // Remove the listener to prevent multiple runs.
        pcAudioSource.removeEventListener('canplay', playWhenReady);

        if (wasPlaying) {
          try {
            await pcAudioSource.play();
          } catch (e) {
            loge(e);
          }
        }
      }
      
      pcAudioSource.addEventListener('canplay', playWhenReady);
    });
    
    pcAudioSource.addEventListener('pause', async (event) => {
    });
    
  } catch (e) {
    loge(e);
  };
};

document.addEventListener('DOMContentLoaded', async (event) => {
  await checkAndRequestPermissions();
  await enumerateDevices();
  await updateDeviceInfo();
  await updateAudioOutputInfo();
    
  htmlAudio = document.getElementById('html-audio');
  htmlAudio.volume = 0.3;
  htmlAudio.tag = 'HTML';
  
  // Event listener to update audio source when the selection changes
  document.getElementById('audio-file-select').addEventListener('change', async (event) => {
    const selectedFile = document.getElementById('audio-file-select').value;
    
    const wasPlaying = !htmlAudio.paused && htmlAudio.currentTime > 0;
    logi('Audio was playing before change: ', wasPlaying);
    
    htmlAudio.src = selectedFile;
    htmlAudio.currentSourceLabel = htmlAudio.src;
    
    async function playWhenReady() {
      // Remove the listener to prevent multiple runs.
      htmlAudio.removeEventListener('canplay', playWhenReady);

      if (wasPlaying) {
        try {
          await htmlAudio.play();
        } catch (e) {
          loge(e);
        }
      }
    }
    
    htmlAudio.addEventListener('canplay', playWhenReady);
  });
  
  await initWebAudio();
  await initPeerConnectionAudio();
  
  gumAudios.forEach((element) => {
    element.tag = 'gUM';
  });
  gumRecordedAudios.forEach((element) => {
    element.tag = 'gUM';
  });
  gdmAudio.tag = 'gDM';
  pcAudio.tag = 'PC';
  
  // Helper functions for logging audio play/pause.
  function logAudioPlay(event) {
    const element = event.target;
    logi(`<${element.tag}> playout starts ` +
      `[source: ${element.currentSourceLabel}][sink: ${element.currentSinkLabel}]`);
  }
  function logAudioPause(event) {
    const element = event.target;
    logi(`<${element.tag}> playout stops ` +
      `[source: ${element.currentSourceLabel}][sink: ${element.currentSinkLabel}]`);
  }
  
  // Attach listeners.
  htmlAudio.addEventListener('play', logAudioPlay);
  htmlAudio.addEventListener('play', updateAudioOutputInfo);
  htmlAudio.addEventListener('pause', logAudioPause);

  gumAudios.forEach(audio => {
    audio.addEventListener('play', logAudioPlay);
    audio.addEventListener('pause', logAudioPause);
  });

  gumRecordedAudios.forEach(audio => {
    audio.addEventListener('play', logAudioPlay);
    audio.addEventListener('pause', logAudioPause);
  });

  gdmAudio.addEventListener('play', logAudioPlay);
  gdmAudio.addEventListener('pause', logAudioPause);

  pcAudio.addEventListener('play', logAudioPlay);
  pcAudio.addEventListener('pause', logAudioPause);
  
  // Set default sink and source for all audio elements and the audio context.
  changeAudioOutput();
  
  // Logic for toggling the visibility of the media stream sections
  const toggleGum1 = document.getElementById('toggle-gum1');
  const toggleGum2 = document.getElementById('toggle-gum2');
  const toggleGdm = document.getElementById('toggle-gdm');

  const gumSection1 = document.getElementById('gum-section-1');
  const gumSection2 = document.getElementById('gum-section-2');
  const gdmSection = document.getElementById('gdm-section');

  toggleGum1.addEventListener('change', () => {
    if (gumSection1) {
        gumSection1.classList.toggle('hidden-section', !toggleGum1.checked);
    }
  });

  toggleGum2.addEventListener('change', () => {
    if (gumSection2) {
        gumSection2.classList.toggle('hidden-section', !toggleGum2.checked);
    }
  });

  toggleGdm.addEventListener('change', () => {
    if (gdmSection) {
        gdmSection.classList.toggle('hidden-section', !toggleGdm.checked);
    }
  });
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

function abbreviateDeviceId(deviceId) {
  if (typeof deviceId === 'string' && deviceId.length > 16) {
    return `${deviceId.substring(0, 8)}..${deviceId.substring(deviceId.length - 8)}`;
  }
  return deviceId;
}

function printGumRequestedConstraints(constraints, index) {
  if (gumRequestedConstraintsDivs[index]) {
    // Create a deep copy of the audio constraints to avoid modifying the original object.
    const constraintsToDisplay = JSON.parse(JSON.stringify(constraints));

    // Check if deviceId.exact exists and is a string.
    if (constraintsToDisplay.deviceId && typeof constraintsToDisplay.deviceId.exact === 'string') {
      constraintsToDisplay.deviceId.exact = abbreviateDeviceId(constraintsToDisplay.deviceId.exact);
    }
    gumRequestedConstraintsDivs[index].textContent = 'Requested constraints:\n' + prettyJson(constraintsToDisplay);
  }
}


function printGumAudioSettings(settings, index) {
  const propertiesToPrint = [
    'autoGainControl',
    'channelCount',
    'deviceId',
    'echoCancellation',
    'groupId',
    'noiseSuppression',
    'sampleRate',
    'voiceIsolation'
  ];

  // Create a deep copy of the settings object to avoid modifying the original.
  const settingsToDisplay = JSON.parse(JSON.stringify(settings));

  // Abbreviate the deviceId if it exists and is a string.
  if (settingsToDisplay.deviceId && typeof settingsToDisplay.deviceId === 'string') {
    settingsToDisplay.deviceId = abbreviateDeviceId(settingsToDisplay.deviceId);
  }
  
  // Abbreviate the deviceId if it exists and is a string.
  if (settingsToDisplay.groupId && typeof settingsToDisplay.groupId === 'string') {
    settingsToDisplay.groupId = abbreviateDeviceId(settingsToDisplay.groupId);
  }

  // MediaStreamTrack: getSettings is the current configuration of the track's constraints.
  const filteredSettings = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = settingsToDisplay[prop];
    return obj;
  }, {});
  gumConstraintsDivs[index].textContent = 'Active settings:\n' + prettyJson(filteredSettings);
  // logi('capabilities:', prettyJson(audioTrack.getCapabilities()));
}

gumDefaultConstraintsCheckbox.addEventListener('change', () => {
  const disabled = gumDefaultConstraintsCheckbox.checked;
  gumAecSelect.disabled = disabled;
  gumNsCheckbox.disabled = disabled;
  gumAgcCheckbox.disabled = disabled;
});


/**
 * TODO: figure out why MediaStreamTrack: getSettings() does not include `systemAudio`.
 * Note that the track will have "label: 'System Audio'" when sharing the screen.
 */
function printGdmAudioSettings(settings, options) {
  const propertiesToPrint = [
    'autoGainControl',
    'channelCount',
    'deviceId',
    'echoCancellation',
    'noiseSuppression',
    'restrictOwnAudio',
    'sampleRate',
    'suppressLocalAudioPlayback',
    'voiceIsolation',
  ];
  
  // MediaStreamTrack: getSettings is the current configuration of the track's constraints.
  let filteredSettings = propertiesToPrint.reduce((obj, prop) => {
    obj[prop] = settings[prop];
    return obj;
  }, {});
  // Adding more properties manually from the supplied options.
  filteredSettings.systemAudio = options.systemAudio;
  filteredSettings.windowAudio = options.windowAudio;
  filteredSettings.preferCurrentTab = options.preferCurrentTab;
  filteredSettings.surfaceSwitching = options.surfaceSwitching;
  filteredSettings.monitorTypeSurfaces = options.monitorTypeSurfaces;
  gdmOptionsDiv.textContent = 'Active options:\n' + prettyJson(filteredSettings);    
};

function printMediaTrackInfo(track, element) {
  const propertiesToPrint = [
      'enabled',
      'id',
      'kind',
      'label',
      'muted',
      'readyState'
  ];
  const filteredTrack = propertiesToPrint.reduce((obj, prop) => {
      obj[prop] = track[prop];
      return obj;
  }, {});
  element.textContent = `MediaStreamTrack:\n` + prettyJson(filteredTrack);
}

function printMediaRecorderInfo(recorder, element) {
  const propertiesToPrint = ['mimeType', 'state'];
  const filteredRecorder = propertiesToPrint.reduce((obj, prop) => {
      obj[prop] = recorder[prop];
      return obj;
  }, {});
  element.textContent = `MediaRecorder:\n` + prettyJson(filteredRecorder);
}

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

function getSelectedDevice(select) {
  const options = select.options;
  if (options.length == 0) {
    return '';
  }
  const deviceLabel = options[options.selectedIndex].label;
  return deviceLabel;
};


async function updateDeviceInfo() {
  const devices = await navigator.mediaDevices.enumerateDevices();
  if (!audioInputSelect || !audioInputInfoDiv) {
    return;
  }
  const selectedInputId = audioInputSelect.value;

  let inputDevice;
  if (selectedInputId === 'default') {
    inputDevice = devices.find(d => d.kind === 'audioinput');
  } else if (selectedInputId === 'communications') {
    inputDevice = devices.find(d => d.deviceId === 'communications' && d.kind === 'audioinput');
  } else {
    inputDevice = devices.find(d => d.deviceId === selectedInputId);
  }

  if (inputDevice) {
    audioInputInfoDiv.textContent = `Audio input device:\n` +
                                `  kind: ${inputDevice.kind}\n` +
                                `  label: ${inputDevice.label}\n` +
                                `  deviceId: ${inputDevice.deviceId}\n` +
                                `  groupId: ${inputDevice.groupId}`;
  } else {
    audioInputInfoDiv.textContent = `Audio input device: Not Found`;
  }
}


async function updateAudioOutputInfo() {
  if (!htmlAudio || !htmlAudio.sinkId || !audioOutputInfoDiv) {
    return;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  const sinkId = htmlAudio.sinkId;
  const outputDevice = devices.find(d => d.deviceId === sinkId && d.kind === 'audiooutput');

  if (outputDevice) {
    audioOutputInfoDiv.textContent = `Audio output device:\n` +
                                 `  kind: ${outputDevice.kind}\n` +
                                 `  label: ${outputDevice.label}\n` +
                                 `  deviceId: ${outputDevice.deviceId}\n` +
                                 `  groupId: ${outputDevice.groupId}`;
  } else {
    audioOutputInfoDiv.textContent = `Audio output device: Not Found`;
  }
}


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
    logi(devices);
    
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
    if (!audioInputSelect || !audioOutputSelect) {
      return;
    }
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
  
  // Set sink ID on these six audio elements using the spreading operator (...). 
  const audioElements = [htmlAudio, ...gumAudios, ...gumRecordedAudios, gdmAudio, pcAudio];
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
    logi(`<${element.tag}> playout sets audio output [source: ${element.currentSourceLabel}]` +
      `[sink: ${element.currentSinkLabel}]`);
  } catch (e) {
     // Jump back to first output device in the list as it's the default.
     audioOutputSelect.selectedIndex = 0;
    loge(e);
  }
}

/** 
 * Start/Stop playing out captured audio on WebAudio audio contexts.
 */
async function playoutOnAudioContext(index) {
  const stream = gumStreams[index];
  if (!stream) {
    return;
  }
  
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  
  // Always stop playout first.
  if (mediaStreamSources[index]) {
    mediaStreamSources[index].disconnect();
    mediaStreamSources[index] = null;
  }
  
  const [track] = stream.getAudioTracks();
  const source = track.label;
  const deviceId = audioOutputSelect.value;
  
  // Start playing out the local stream on a WebAudio context using an MSS.
  if (gumPlayAudioContextCheckboxes[index].checked) {
    mediaStreamSources[index] = audioContext.createMediaStreamSource(stream);
    mediaStreamSources[index].connect(audioContext.destination);
    
    // Avoid explicitly setting `default` as sink ID since it is not supported on all browsers.
    if (deviceId !== 'default') {
      await audioContext.setSinkId(deviceId);
      logi('[WebAudio] local playout sets audio output ' +
          `[source: ${source}}][sink: ${getSelectedDevice(audioOutputSelect)}]`)
    }
    logi('[WebAudio] local playout starts ' +
          `[source: ${source}}][sink: ${getSelectedDevice(audioOutputSelect)}]`)
    logi(`AudioContext.sinkId=${audioContext.sinkId}`);
  } else {
    logi('[WebAudio] local playout stops ' +
          `[source: ${source}}][sink: ${getSelectedDevice(audioOutputSelect)}]`)
  }
}

/** 
 * Encapsulates a level meter given a specified canvas object.
 * @param canvas The canvas object on which the level meter is rendered.
 * @return Returns the frame ID from `requestAnimationFrame` so the animation can be stopped.
 */

async function startLevelMeter(stream, canvas) {
  if (!audioContext) {
    audioContext = new AudioContext();
  }
  
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  // An FFT size of 256 is sufficient for our purposes. Results in 128 frequency bins. 
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.9;
  source.connect(analyser);
  
  const canvasCtx = canvas.getContext('2d');
  
  const bufferLength = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLength);
  
  let animationFrameId;
  function drawLevelMeter() {
    // Schedule the drawLevelMeter() function to run on the next animation frame.
    // requestAnimationFrame ensures the drawLevelMeter() function runs once per display refresh
    // (e.g., 60Hz = ~16.67ms interval).
    // The ID is assigned directly to `animationFrameId`.
    animationFrameId = requestAnimationFrame(drawLevelMeter);

    analyser.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    canvasCtx.fillStyle = 'lime';
    canvasCtx.fillRect(0, 0, (average / 256) * canvas.width, canvas.height);
  }

  drawLevelMeter();
  
  // Wait for one frame to be rendered to ensure a valid `animationFrameId`.
  await new Promise(resolve => requestAnimationFrame(resolve));
  return animationFrameId;
};

function parseAecModes(value) {
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  // It's not a boolean string, so return it as-is.
  return value;
}

async function startGum(index) {
  logi(`startGum(${index})`);
  // Get the input device ID based on what is currently selected.
  const audioSource = audioInputSelect.value;
  const audioSink = audioOutputSelect.value;
  // Avoid opening the same device again.
  if (hasMicrophonePermission && openMicId === audioSource) {
    logi(`${audioSource}) is already open`);
    return;
  }

  // Close existing streams.
  stopGum(index);
  
  try {
    logw('');
    loge('');
    let constraints;
    if (gumDefaultConstraintsCheckbox.checked) {
      constraints = { audio: true, video: false };
    } else {
      constraints = {
        audio: {
          echoCancellation: {exact: false},
          autoGainControl: {exact: false},
          noiseSuppression: {exact: false},
        },
        video: false,
      };
      // Set processed constraints for the first guM stream.
      if (index === 0) {
        const aecMode = parseAecModes(gumAecSelect.value);
        logi('final AEC mode in constraints: ' + aecMode);
        constraints.audio.echoCancellation = {exact: aecMode};
        constraints.audio.autoGainControl = {exact: gumAgcCheckbox.checked};
        constraints.audio.noiseSuppression = {exact: gumNsCheckbox.checked};
      }
      // Add a `deviceId` property to the `audio` object if a microphone is available.
      if (hasMicrophone) {
        constraints.audio.deviceId = audioSource ? {exact: audioSource} : undefined;
      }
    }
    logi('requested constraints to getUserMedia: ', prettyJson(constraints));
    printGumRequestedConstraints(constraints, index);
    // MediaDevices: getUserMedia()
    gumStreams[index] = await navigator.mediaDevices.getUserMedia(constraints);
    const [audioTrack] = gumStreams[index].getAudioTracks();
    logi('[gUM] audioTrack: ', audioTrack);
    const settings = audioTrack.getSettings();
    logi('[gUM] MediaStreamTrack: getSettings: ', settings);
    printGumAudioSettings(settings, index);
    printMediaTrackInfo(audioTrack, gumTrackDivs[index]);
    // Store the currently selected and active (unique) microphone ID.
    openMicId = settings.deviceId;
     
    audioTrack.onmute = (event) => {
      logw('[gUM] MediaStreamTrack.onmute: ' + audioTrack.label);
      printMediaTrackInfo(audioTrack, gumTrackDivs[index]);
    }
    audioTrack.onunmute = (event) => {
      logw('[gUM] MediaStreamTrack.onunmute: ' + audioTrack.label);
      printMediaTrackInfo(audioTrack, gumTrackDivs[index]);
    }
    audioTrack.onended = (event) => {
      logw('[gUM] MediaStreamTrack.onended: ' + audioTrack.label);
      stopGum(index);
    }
    
    // The `autoplay` attribute of the audio tag is not set.
    gumAudios[index].srcObject = gumStreams[index];
    updateSourceLabel(gumAudios[index]);
    if (gumPlayAudioCheckboxes[index].checked) {
      await gumAudios[index].play();
    }
    
    playoutOnAudioContext(index);
    
    gumAnimationFrameId[index] = startLevelMeter(gumStreams[index], gumCanvases[index]);
       
    gumButtons[index].disabled = true;
    gumStopButtons[index].disabled = false;
    gumMuteCheckboxes[index].disabled = false;
    gumAecSelect.disabled = true;
    gumNsCheckbox.disabled = true;
    gumAgcCheckbox.disabled = true;
    gumRecordButtons[index].disabled = false;
    
    logi(`opened media stream [id=${gumStreams[index].id}]`);
  } catch (e) {
    loge(e);
  }
}

gumButtons.forEach((button, index) => {
  button.onclick = async () => {
    await startGum(index);
  };
});

function stopGum(index) {
  if (!gumStreams[index]) {
    return;
  }
  logi(`stopGum(${index})`);
  const streamId = gumStreams[index].id;
  const [track] = gumStreams[index].getAudioTracks();
  track.onmute = null;
  track.onumute = null;
  track.onended = null;
  track.stop();
  gumStreams[index] = null;
  openMicId = undefined;
  gumAudios[index]  .srcObject = null;
  gumButtons[index].disabled = false;
  gumStopButtons[index].disabled = true;
  gumMuteCheckboxes[index].disabled = true;
  if (!gumDefaultConstraintsCheckbox.checked) {
    gumAecSelect.disabled = false;
    gumNsCheckbox.disabled = false;
    gumAgcCheckbox.disabled = false;
  }
  gumRecordButtons[index].textContent = 'Start Recording';
  gumRecordButtons[index].disabled = true;
  clearGumInfoContainer();
  updateSourceLabel(gumAudios[index]);
  if (gumAnimationFrameId[index]) {
    cancelAnimationFrame(gumAnimationFrameId[index]);
    const canvasCtx = gumCanvases[index].getContext('2d');
    canvasCtx.clearRect(0, 0, gumCanvases[index].width, gumCanvases[index].height);
  }
  if (mediaStreamSources[index]) {
    mediaStreamSources[index].disconnect();
    mediaStreamSources[index] = null;
  }
  logi(`closed media stream [id=${streamId}]`);
};

gumStopButtons.forEach((button, index) => {
  button.onclick = () => {
  stopGum(index);
};
});

gumMuteCheckboxes.forEach((checkbox, index) => {
  checkbox.onchange = () => {
    if (gumStreams[index]) {
      const [track] = gumStreams[index].getAudioTracks();
      track.enabled = !checkbox.checked;
      printMediaTrackInfo(track, gumTrackDivs[index]);
    }
  };
});


gumPlayAudioCheckboxes.forEach((checkbox, index) => {
  checkbox.onclick = async () => {
    const audio = gumAudios[index];
    if (checkbox.checked) {
      if (audio.srcObject && audio.paused) {
        await audio.play();
      }
    } else {
      if (audio.srcObject && !audio.paused) {
        await audio.pause();
      }
    }
  };
});

gumPlayAudioContextCheckboxes.forEach((checkbox, index) => {
  checkbox.onclick = async () => {
    playoutOnAudioContext(index);
  };
});

function startGumRecording(index) {
  if (!gumStreams[index]) {
    return;
  }
  
  gumRecordedAudios[index].src = '';
  gumRecordedAudios[index].disabled = true;
  
  gumRecordedBlobs[index] = [];
  // Get the best possible mime type given what the browser supports.
  const mimeType = getSupportedMimeType();
  const options = {mimeType};
  if (!mimeType) {
    console.error(`MediaRecorder only support very few mime types`);
    return;
  }
  
  try {
    gumMediaRecorders[index] = new MediaRecorder(gumStreams[index], options);
    gumRecordButtons[index].textContent = 'Stop Recording';
    
    gumMediaRecorders[index].onstart = (event) => {
      printMediaRecorderInfo(gumMediaRecorders[index], gumRecordedDivs[index]);
    };
    
    gumMediaRecorders[index].onstop = (event) => {
      const superBuffer = new Blob(gumRecordedBlobs[index], {type: mimeType});
      gumRecordedAudios[index].src = '';
      gumRecordedAudios[index].srcObject = null;
      gumRecordedAudios[index].src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gumRecordedAudios[index]);
      printMediaRecorderInfo(gumMediaRecorders[index], gumRecordedDivs[index]);
      gumRecordedDivs[index].textContent += '\nrecorded blob size: ' + superBuffer.size;
    };
    
    gumMediaRecorders[index].ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        gumRecordedBlobs[index].push(event.data);
      }
    };
    
    gumMediaRecorders[index].start();
  } catch (e) {
    loge(e); 
  }
};

function stopGumRecording(index) {
  if (gumMediaRecorders[index]) {
    gumMediaRecorders[index].stop();
  }
};

gumRecordButtons.forEach((button, index) => {
  button.onclick = () => {
    if (button.textContent === 'Start Recording') {
      startGumRecording(index);
    } else {
      stopGumRecording(index);
      button.textContent = 'Start Recording';
    }
  }
});

/** Restart the local MediaStreamTrack (gUM) when a new input device is selected. */
audioInputSelect.onchange = async () => {
  const deviceLabel = getSelectedDevice(audioInputSelect);
  logi(`Selected input device: ${deviceLabel}`);
  await updateDeviceInfo();
  // Restart active streams using the new device selection.
  gumStreams.forEach(async (stream, index) => {
    if (stream) {
      await startGum(index);
    }
  });
};

/** Set sink ID for all audio elements based on the latest output device selection. */
audioOutputSelect.onchange = async () => {
  const deviceLabel = getSelectedDevice(audioOutputSelect);
  logi(`Selected output device: ${deviceLabel}`);
  await updateAudioOutputInfo();  
  await changeAudioOutput();
};

/** 
 * The devicechange event is sent to a MediaDevices instance whenever a media device such as a
 * camera, microphone, or speaker is connected to or removed from the system.
 */
navigator.mediaDevices.ondevicechange = async () => {
  logw('MediaDevices: devicechange');
  const restartAudioCheckbox = document.getElementById('restart-audio');
  // Refresh the list (and selection) of available devices.
  await enumerateDevices();
  if (restartAudioCheckbox.checked) {
    logi('Restarting active audio streams...');
    // Restart active streams using the new device selection.
    gumStreams.forEach(async (stream, index) => {
      if (stream) {
        await startGum(index);
      }
    });
  }
};

function startGdmRecording() {
  if (!gdmStream) {
    return;
  }
  
  gdmRecordedAudio.src = '';
  gdmRecordedAudio.disabled = true;
  
  gdmRecordedBlobs = [];
  // Get the best possible mime type given what the browser supports.
  const mimeType = getSupportedMimeType();
  const options = {mimeType};
  if (!mimeType) {
    console.error(`MediaRecorder only support very few mime types`);
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
      printMediaRecorderInfo(gdmMediaRecorder, gdmRecordedDiv);
    };
    
    gdmMediaRecorder.onstop = (event) => {
      const superBuffer = new Blob(gdmRecordedBlobs, {type: mimeType});
      gdmRecordedAudio.src = '';
      gdmRecordedAudio.srcObject = null;
      gdmRecordedAudio.src = URL.createObjectURL(superBuffer);
      updateSourceLabel(gdmRecordedAudio);
      printMediaRecorderInfo(gdmMediaRecorder, gdmRecordedDiv);
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
    logw('');
    loge('');
    let options;
    if (gdmDefaultOptionsCheckbox.checked) {
      options = { video: true, audio: true };
    } else {
      options = {
        video: true,
        audio: {
          echoCancellation: gdmAecCheckbox.checked,
          autoGainControl: gdmAgcCheckbox.checked,
          noiseSuppression: gdmNsCheckbox.checked,
          suppressLocalAudioPlayback: !gdmLocalAudioPlaybackCheckbox.checked,
          restrictOwnAudio: gdmRestrictOwnAudioCheckbox.checked,
        },
        systemAudio: (gdmSystemAudioCheckbox.checked ? 'include' : 'exclude'),
        preferCurrentTab: gdmPreferCurrentTabCheckbox.checked,
        surfaceSwitching: 'exclude',
        monitorTypeSurfaces: 'include',
      };
      if (gdmWindowAudioSelect.value != 'notset') {
        options['windowAudio'] = gdmWindowAudioSelect.value;
      }
    }
    logi('requested options to getDisplayMedia: ', prettyJson(options));
    
    /** 
     * MediaDevices: getDisplayMedia()
     */
    gdmStream = await navigator.mediaDevices.getDisplayMedia(options);
    const [videoTrack] = gdmStream.getVideoTracks();
    if (videoTrack) {
      const settings = videoTrack.getSettings();
      logi('[gDM] videoTrack.getSettings: ', settings);
    }
    const [audioTrack] = gdmStream.getAudioTracks();
    if (audioTrack) {
      const settings = audioTrack.getSettings();
      logi('[gDM] audioTrack: ', audioTrack);
      logi('[gDM] audioTrack.getSettings: ', settings);
      printGdmAudioSettings(settings, options);
      printMediaTrackInfo(audioTrack, gdmTrackDiv);
    
      audioTrack.onmute = (event) => {
        logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
        printMediaTrackInfo(audioTrack, gdmTrackDiv);
      }
      audioTrack.onunmute = (event) => {
        logi('[gDM] MediaStreamTrack.onunmute: ' + audioTrack.label);
        printMediaTrackInfo(audioTrack, gdmTrackDiv);
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
      
      gdmAnimationFrameId = startLevelMeter(gdmStream, gdmCanvas);
      
      gdmButton.disabled = true;
      gdmStopButton.disabled = false;
      gdmAecCheckbox.disabled = true;
      gdmNsCheckbox.disabled = true;
      gdmAgcCheckbox.disabled = true;
      gdmLocalAudioPlaybackCheckbox.disabled = true;
      gdmWindowAudioSelect.disabled = true;
      gdmSystemAudioCheckbox.disabled = true;
      gdmRestrictOwnAudioCheckbox.disabled = true;
      gdmPreferCurrentTabCheckbox.disabled = true;
      gdmMuteCheckbox.disabled = false;
      gdmRecordButton.disabled = false;
    } else {
      // Keep video alive to ensure that the sharing pop-up UI is displayed. 
      let deviceId;
      const [videoTrack] = gdmStream.getVideoTracks();
      if (videoTrack) {
        videoTrack.addEventListener('ended', () => {
          logi('[gDM] MediaStreamTrack.ended: ' + videoTrack.label);
          stopGdm();
        });
        
        const settings = videoTrack.getSettings();
        deviceId = settings.deviceId;
      }
      logw(`No audio track exists for the selected source: ${deviceId}`);
    }
  } catch (e) {
    loge(e);
  }
}  

gdmButton.onclick = async () => {
  await startGdm();
};

function stopGdm() {
  if (gdmStream) {
    const [videoTrack] = gdmStream.getVideoTracks();
    if (videoTrack) {
      videoTrack.stop();
    }
    const [audioTrack] = gdmStream.getAudioTracks();
    if (audioTrack) {
      audioTrack.stop();
    }
    gdmStream = null;
    gdmAudio.srcObject = null;
    gdmButton.disabled = false;
    gdmStopButton.disabled = true;
    if (!gdmDefaultOptionsCheckbox.checked) {
      gdmAecCheckbox.disabled = false;
      gdmNsCheckbox.disabled = false;
      gdmAgcCheckbox.disabled = false;
      gdmPreferCurrentTabCheckbox.disabled = false;
      gdmLocalAudioPlaybackCheckbox.disabled = false;
      gdmSystemAudioCheckbox.disabled = false;
      gdmWindowAudioSelect.disabled = false;
      gdmRestrictOwnAudioCheckbox.disabled = false;
    }
    gdmMuteCheckbox.disabled = true;
    gdmRecordButton.textContent = 'Start Recording';
    gdmRecordButton.disabled = true;
    clearGdmInfoContainer();
    updateSourceLabel(gdmAudio);
    if (gdmAnimationFrameId) {
      cancelAnimationFrame(gdmAnimationFrameId);
      const canvasCtx = gdmCanvas.getContext('2d');
      canvasCtx.clearRect(0, 0, gdmCanvas.width, gdmCanvas.height);
    }
  }
};

gdmStopButton.onclick = () => {
  stopGdm();
};

gdmMuteCheckbox.onclick = () => {
  if (gdmStream) {
    const [track] = gdmStream.getAudioTracks();
    if (!track) {
      track.enabled = !checkbox;
      printGdmAudioTrack(track);
    }
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

gdmDefaultOptionsCheckbox.addEventListener('change', () => {
  const disabled = gdmDefaultOptionsCheckbox.checked;
  gdmAecCheckbox.disabled = disabled;
  gdmNsCheckbox.disabled = disabled;
  gdmAgcCheckbox.disabled = disabled;
  gdmLocalAudioPlaybackCheckbox.disabled = disabled;
  gdmSystemAudioCheckbox.disabled = disabled;
  gdmWindowAudioSelect.disabled = disabled;
  gdmRestrictOwnAudioCheckbox.disabled = disabled;
  gdmPreferCurrentTabCheckbox.disabled = disabled;
});


