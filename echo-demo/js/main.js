'use strict';

const gumAudio = document.getElementById('gum-audio');
const gumButton = document.getElementById('gum');
const gumStopButton = document.getElementById('gum-stop');
const constraintsDiv = document.getElementById('constraints');
const errorElement = document.getElementById('error-message');

let gumStream;

gumStopButton.disabled = true;

const logi = (...args) => {
  console.log(...args);
}

const logw = (...args) => {
  console.warn(...args);
}

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const constraints = {
      audio: true,
      echoCancellation: {exact: true},
      video: false,
    };

const loge = (error) => {
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

gumButton.onclick = async () => {
  try {
    // const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // logi(prettyJson(supportedConstraints));
    
    gumStream = await navigator.mediaDevices.getUserMedia(constraints);
    const [audioTrack] = gumStream.getAudioTracks();
    logi('audioTrack:', audioTrack);
    constraintsDiv.textContent = 'constraints:\n' + prettyJson(audioTrack.getSettings());
    // logi('capabilities:', prettyJson(audioTrack.getCapabilities()));
    
    gumAudio.srcObject = gumStream;
       
    gumButton.disabled = true;
    gumStopButton.disabled = false;
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
  }
};

