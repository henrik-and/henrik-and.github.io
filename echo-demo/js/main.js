'use strict';

const gumAudio = document.getElementById('gum-audio');
const gumButton = document.getElementById('gum');
const gumAecCheckbox = document.getElementById('gum-aec');
const gumStopButton = document.getElementById('gum-stop');
const gumMuteCheckbox = document.getElementById('gum-mute');
const gumConstraintsDiv = document.getElementById('gum-constraints');
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

