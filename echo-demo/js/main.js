'use strict';

const gumAudio = document.getElementById('gum-audio');
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

document.addEventListener('DOMContentLoaded', (event) => {
  htmlAudio = document.getElementById("html-audio");
  htmlAudio.volume = 0.3; 
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

gumButton.onclick = async () => {
  try {
    // const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // logi(prettyJson(supportedConstraints));
    
    const constraints = {
      audio: {
        echoCancellation: {exact: gumAecCheckbox.checked},
        autoGainControl: {exact: true},
        noiseSuppression: {exact: true},
      },
      video: false,
    };
    
    logi('requested constraints to getUserMedia: ', prettyJson(constraints));
    gumStream = await navigator.mediaDevices.getUserMedia(constraints);
    const [audioTrack] = gumStream.getAudioTracks();
    logi('audioTrack:', audioTrack);
    
    printAudioSettings(audioTrack.getSettings());
    printAudioTrack(audioTrack);
     
    audioTrack.onmute = () => {
      logi('MediaStreamTrack.onmute: ' + audioTrack.label);
      printAudioTrack(audioTrack);
    };
    audioTrack.onunmute = () => {
      logi('MediaStreamTrack.onmute: ' + audioTrack.label);
      printAudioTrack(audioTrack);
    };
    
    gumAudio.srcObject = gumStream;
       
    gumButton.disabled = true;
    gumStopButton.disabled = false;
    gumMuteCheckbox.disabled = false;
    gumAecCheckbox.disabled = true;
    gumRecordButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

gumStopButton.onclick = () => {
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    track.stop();
    gumAudio.srcObject = null;
    gumButton.disabled = false;
    gumStopButton.disabled = true;
    gumMuteCheckbox.disabled = true;
    gumAecCheckbox.disabled = false;
    gumRecordButton.textContent = 'Start Recording';
    gumRecordButton.disabled = true;
    gumRecordedAudio.src = '';
    gumRecordedAudio.disabled = true;
    clearGumInfoContainer();
  }
};

gumMuteCheckbox.onchange = () => {
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    track.enabled = !gumMuteCheckbox.checked;
    printAudioTrack(track);
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

// gumButton.innerHTML = "&#x25B6;&#xFE0F;" : "&#x23F8;&#xFE0F;";

/*
Calling MediaStreamTrack: applyConstraints with `echoCancellation` as constraint
results in: DOMException: OverconstrainedError [Cannot satisfy constraints].
gumAecCheckbox.onchange = async () => {
  if (gumStream) {
    try {
      const [track] = gumStream.getAudioTracks();
      const constraints = {
        echoCancellation: {exact: gumAecCheckbox.checked},
      }
      logi('requested constraints to applyConstraints: ', prettyJson(constraints));
      await track.applyConstraints(constraints);
      printAudioSettings(track.getSettings());
    } catch (e) {
      loge(e);
    }
  }
};
*/

/*
htmlAudio.addEventListener('play', (event) => {
  logi('<audio> Audio playback started');
});

htmlAudio.addEventListener('pause', (event) => {
  logi('<audio> Audio playback paused');
});

htmlAudio.addEventListener('ended', (event) => {
  logi('<audio> Audio playback ended');
});

htmlAudio.addEventListener('error', (event) => {
  let errorMessage = "An error occurred while trying to play the audio.";

  switch (htmlAudio.error.code) {
    case htmlAudio.error.MEDIA_ERR_ABORTED:
      errorMessage = "Audio playback was aborted.";
      break;
    case htmlAudio.error.MEDIA_ERR_NETWORK:
      errorMessage = "A network error occurred.";
      break;
    case htmlAudio.error.MEDIA_ERR_DECODE:
      errorMessage = "The audio file could not be decoded.";
      break;
    case htmlAudio.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
      // Check if the error is specifically due to a 404 (Not Found)
      if (htmlAudio.networkState === htmlAudio.NETWORK_NO_SOURCE) {
        errorMessage = "The audio file could not be found.";
      } else {
        errorMessage = "The audio source is not supported.";
      } 
      break;
  }

  console.error(errorMessage);
});
*/

