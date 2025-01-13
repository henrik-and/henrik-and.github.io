'use strict';

const gumAudio = document.getElementById('gum-audio');
const gumButton = document.getElementById('gum');
const gumAecCheckbox = document.getElementById('gum-aec');
const gumStopButton = document.getElementById('gum-stop');
const gumMuteCheckbox = document.getElementById('gum-mute');
const gumConstraintsDiv = document.getElementById('gum-constraints');
const htmlAudio = document.getElementById('html-audio');
const errorElement = document.getElementById('error-message');

let gumStream;

gumStopButton.disabled = true;
gumMuteCheckbox.disabled = true;
gumAecCheckbox.disabled = false;

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

const printAudioSettings = (settings) => {
  const propertiesToPrint = [
      "echoCancellation",
      "autoGainControl",
      "noiseSuppression",
      "sampleRate",
      "voiceIsolation"
    ];

    //  MediaStreamTrack: getSettings is the current configuration of the track's constraints.
    const filteredSettings = propertiesToPrint.reduce((obj, prop) => {
      obj[prop] = settings[prop];
      return obj;
    }, {});
    gumConstraintsDiv.textContent = 'Active constraints:\n' + prettyJson(filteredSettings);
    // logi('capabilities:', prettyJson(audioTrack.getCapabilities()));
    
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
     
    audioTrack.onmute = () => {
      logi('MediaStreamTrack.onmute: ' + audioTrack.label);
      logi(audioTrack);
    };
    audioTrack.onunmute = () => {
      logi('MediaStreamTrack.onmute: ' + audioTrack.label);
      logi(audioTrack);
    };
    
    gumAudio.srcObject = gumStream;
       
    gumButton.disabled = true;
    gumStopButton.disabled = false;
    gumMuteCheckbox.disabled = false;
    gumAecCheckbox.disabled = true;
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
  }
};

gumMuteCheckbox.onchange = () => {
  if (gumStream) {
    const [track] = gumStream.getAudioTracks();
    track.enabled = !gumMuteCheckbox.checked;
  }
};

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

