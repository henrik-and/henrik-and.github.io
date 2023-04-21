'use strict';

const videoElement = document.getElementById("video");
const myConsoleTextArea = document.getElementById('myConsole');
const logElement = document.getElementById("log");
const videoFpsDiv = document.getElementById("videoFps");
const pauseButton = document.getElementById("videoPauseButton");
const playButton = document.getElementById("videoPlayButton");

pauseButton.setAttribute('disabled','disabled');
playButton.setAttribute('disabled','disabled');

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;

let mediaTrackConstraints = {};

(()=>{
  const console_log = window.console.log;
  window.console.log = function(...args) {
    console_log(...args);
    if (!myConsoleTextArea) return;
    args.forEach(arg=>myConsoleTextArea.value += `${prettyJson(arg)}\n`);
  }
})();

function clearConsole() {
	if (!myConsoleTextArea) return;
  myConsoleTextArea.value  = '';
}

function logError(msg) {
  logElement.innerHTML += `${msg}<br>`;
}

videoElement.addEventListener('loadedmetadata', function() {
  console.log(`Video dimensions: ${this.videoWidth}x${this.videoHeight}px`);
});

function main() {
	setTimeout(updateVideoFps, 30);
}

function logStream(stream) {
  const videoTrack = stream.getVideoTracks()[0];
  // List the set of constraints passed into the last applyConstraints.
  console.log('Track constraints:', videoTrack.getConstraints());
  // List each supported constraint and the values or range of values that are supported.
  // console.log('Track capabilities:', videoTrack.getCapabilities());
  // Show the complete representation of the track's current configuration.
  console.log('Track settings:', videoTrack.getSettings());
}

document.getElementById("getDisplayMediaButton").onclick = async () => {
	clearConsole();
  
  let videoConstraints = {};
  // if (cursor.value !== 'default') {
  //   mediaTrackConstraints.cursor = cursor.value;
  //   videoConstraints = {video: mediaTrackConstraints};
  // }
  
  mediaTrackConstraints.height = 1440
  mediaTrackConstraints.width = 2560
  videoConstraints = {video: mediaTrackConstraints};
  
  console.log('Requested getDisplayMedia constraints:', videoConstraints);
  
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(videoConstraints);
    const videoTrack = stream.getVideoTracks()[0];
    await videoTrack.applyConstraints(mediaTrackConstraints);
    videoElement.srcObject = stream;
    logStream(stream);
    pauseButton.removeAttribute('disabled');
  } catch (e) {
    logError(e);
  }
};

pauseButton.onclick = () => {
  pauseButton.setAttribute('disabled','disabled');
  playButton.removeAttribute('disabled');
  videoElement.pause();
};

playButton.onclick = () => {
  playButton.setAttribute('disabled','disabled');
  pauseButton.removeAttribute('disabled');
  videoElement.play();
};

setInterval(() => {
  if (videoElement.videoWidth) {
  	videoFpsDiv.innerHTML = `<strong>Video framerate:</strong> ${localFps.toFixed(1)} fps`;
  }
}, 1000);

const updateVideoFps = () => {
  const now = performance.now();
  const periodMs = now - oldTimestampMs;
  oldTimestampMs = now;
  
  if (videoElement.getVideoPlaybackQuality()) {
  	let newFps;
  	const newFrames = videoElement.getVideoPlaybackQuality().totalVideoFrames;
  	const framesSinceLast = newFrames - oldLocalFrames;
  	oldLocalFrames = newFrames;
  	if (framesSinceLast >= 0) {
  		newFps = 1000 * framesSinceLast / periodMs;
  		localFps = 0.9 * localFps + 0.1 * newFps;
  	}
  }
  setTimeout(updateVideoFps, 30);
}

main();
