// https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture
// https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia
// https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamTrack/applyConstraints

'use strict';

const videoElement = document.getElementById("video");
const videoSize = document.getElementById("videoSize");
const videoFps = document.getElementById("videoFps");
const myConsoleTextArea = document.getElementById("myConsole");
const logElement = document.getElementById("log");
const startButton = document.getElementById("getDisplayMediaButton");
const pauseButton = document.getElementById("videoPauseButton");
const playButton = document.getElementById("videoPlayButton");
const applyButton = document.getElementById("applyConstraintsButton");
const constraintsFieldset = document.getElementById("constraints");

pauseButton.disabled = true;
playButton.disabled = true;
applyButton.disabled = true;
constraintsFieldset.disabled = true;

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

let oldTimestampMs = 0;
let oldLocalFrames = 0;
let localFps = 30;

let supportedConstraints = {};
let mediaTrackConstraints = {};

let videoStream = null;


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

function showScreenProperties() {
  let screen = window.screen;
  let pxRatio = window.devicePixelRatio;
  console.log(`Screen resolution: ${screen.width * pxRatio}x${screen.height * pxRatio}px`);
  if (pxRatio !== 1.0) {
    console.log(`Pixel ratio: ${pxRatio}`);
    console.log(`Screen dimension: ${screen.width}x${screen.height}px`);
  }
}

function main() {
  clearConsole();
  showScreenProperties();
  supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
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

const setStream = async (stream) => {
  startButton.disabled = true;
  pauseButton.disabled = false;
  const videoTrack = stream.getVideoTracks()[0];
  videoElement.srcObject = stream;
  videoStream = stream;
  
  videoTrack.onmute = () => {
    console.log(`local ${videoTrack.kind} mute (muted = ${videoTrack.muted})`);
  }
  
  videoTrack.onunmute = () => {
    console.log(`local ${videoTrack.kind} unmute (muted = ${videoTrack.muted})`);
  }
  
  videoTrack.addEventListener('ended', () => {
    videoSize.textContent = '0x0';
    clearConsole();
    showScreenProperties();
    startButton.disabled = false;
    playButton.disabled = true;
    pauseButton.disabled = true;
    applyButton.disabled = false;
    constraintsFieldset.disabled = false;
    videoStream = null;
  });
  
  videoElement.ontimeupdate = () => {
    console.log(videoElement.currentTime);
  }
  
  videoElement.onloadedmetadata = (e) => {
    videoSize.textContent = video.videoWidth + 'x' + video.videoHeight;
  };

  videoElement.onresize = (e) => {
    videoSize.textContent = video.videoWidth + 'x' + video.videoHeight;
  };
  logStream(stream);
};

// Note: min and exact values are not permitted in constraints used in MediaDevices.getDisplayMedia()
// calls — they produce a TypeError — but they are allowed in constraints used in
// MediaStreamTrack.applyConstraints() calls.
// See https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints#constraindouble.
startButton.onclick = async () => {
  let displayMediaOptions = {};
  
  if (height.value !== 'default') {
    mediaTrackConstraints.height = height.value;
  }
  if (width.value !== 'default') {
    mediaTrackConstraints.width = width.value;
  }
  if (frameRate.value !== 'default') {
    mediaTrackConstraints.frameRate = {ideal: frameRate.value};
  }
  if (supportedConstraints.displaySurface) {
    if (displaySurface.value !== 'default') {
      mediaTrackConstraints.displaySurface = displaySurface.value; 
    }
  }
 
  displayMediaOptions = {video: mediaTrackConstraints, audio: false};
  console.log('Requested getDisplayMedia options:', displayMediaOptions);
  
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);
    await setStream(stream);
    playButton.disabled = true;
    applyButton.disabled = false;
    constraintsFieldset.disabled = false;
  } catch (e) {
    logError(e);
  }
};

pauseButton.onclick = () => {
  pauseButton.disabled = true;
  playButton.disabled = false;
  videoElement.pause();
};

playButton.onclick = () => {
  playButton.disabled = true;
  pauseButton.disabled = false;
  applyButton.disabled = false;
  constraintsFieldset.disabled = false;
  videoElement.play();
};

// https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints
applyButton.onclick = async () => {
  let constraints = {};
  
  if (applyHeight.value !== 'default') {
    constraints.height = applyHeight.value;
  }
  if (applyWidth.value !== 'default') {
    constraints.width = applyWidth.value;
  }
  if (applyFrameRateMin.value !== 'default' && applyFrameRateMax.value == 'default') {
    constraints.frameRate = {min: applyFrameRateMin.value};
  }
  if (applyFrameRateMin.value == 'default' && applyFrameRateMax.value !== 'default') {
    constraints.frameRate = {max: applyFrameRateMax.value};
  }
  if (applyFrameRateMin.value !== 'default' && applyFrameRateMax.value !== 'default') {
    constraints.frameRate = {min: applyFrameRateMin.value, max: applyFrameRateMax.value};
  }
 
  console.log('Requested applyConstraints:', constraints);
  if (videoStream) {
    const videoTrack = videoStream.getVideoTracks()[0];
    await videoTrack.applyConstraints(constraints);
  }
}

setInterval(() => {
  if (videoElement.videoWidth) {
    videoFps.textContent = localFps.toFixed(1);
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
