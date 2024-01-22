'use strict';

const remoteVideo = document.getElementById('remote');
const gumButton = document.getElementById('gum');
const drawButton = document.getElementById('draw');
const captureButton = document.getElementById('capture');
const stopButton = document.getElementById('stop');
const crop = document.getElementById('crop');
const qualitySelector = document.getElementById('quality');
const rateSelector = document.getElementById('rate');
const resolutionSelector = document.getElementById('resolution');

drawButton.disabled = true;
captureButton.disabled = true;
stopButton.disabled = true;
crop.checked = true;

let stream;
let canvasStreamstream;
let context2d;
let canvasStream;
let intervalId;
let params;

let canvas;
let localVideo;

const vgaConstraints = {
  video: {width: {exact: 640}, height: {exact: 480}}
};

const hdConstraints = {
  video: {width: {exact: 1280}, height: {exact: 720}}
};

const prettyJson = (obj) => JSON.stringify(obj, null, 2);

const loge = (error) => {
  const errorElement = document.getElementById('error-message');
  errorElement.textContent = `DOMException: ${error.name} [${error.message}]`;
  console.error(error);
};

remoteVideo.addEventListener('loadedmetadata', function() {
  console.log(`Local video videoWidth: ${this.videoWidth}px,  videoHeight: ${this.videoHeight}px`);
  console.log(`Local video offsetWidth: ${this.offsetWidth}px,  videoHeight: ${this.offsetHeight}px`);
});

function getCropAndScaleParameters() {
  if (resolution.value === 'VGA') {
    return {
      originLeft: 320,
      originTop: 240,
      scaledWidth: 320,
      scaledHeight: 240
    }
  } else {
    return {
      originLeft: 640,
      originTop: 360,
      scaledWidth: 640,
      scaledHeight: 360
    }
  }  
};

gumButton.onclick = async () => {
  try {
    const supportedConstraints = navigator.mediaDevices.getSupportedConstraints();
    // console.log(prettyJson(supportedConstraints));
    let constraints = {};
    if (resolution.value === 'VGA') {
      constraints = vgaConstraints;
    } else {
      constraints = hdConstraints;
    }
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    const [videoTrack] = stream.getVideoTracks();
    console.log('Active constraints: ', videoTrack.getConstraints());
    console.log('videoTrack:', videoTrack);
    
    if (crop.checked) {
      console.log('Using path with canvas and extra video tag');
      localVideo = document.createElement('video');
      canvas = document.createElement('canvas');
      localVideo.srcObject = stream;
      localVideo.play();
      drawButton.disabled = false;
    } else {
      console.log('Using path without canvas and extra video tag');
      remoteVideo.scrObject = stream;
    }
    
    gumButton.disabled = true;
    resolutionSelector.disabled = true;
    stopButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

function startCropAndScaleTimer() {
  intervalId = setInterval(() => {
    // Cut out a section of the source image, then scale and draw it on our canvas.
    // https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Using_images#slicing
    context2d.drawImage(localVideo, params.originLeft, params.originTop, params.scaledWidth, params.scaledHeight, 0, 0, canvas.width, canvas.height);
    // Pass through without cropping.
    // context2d.drawImage(localVideo, 0, 0);
    if (canvasStream) {
      const [track] = canvasStream.getVideoTracks();
      if (track) {
        // Send the current state of the canvas as a frame to the stream.
        track.requestFrame();
      }
    }
  }, 1000 / rate.value);
  return intervalId;
};

drawButton.onclick = async () => {
  try {
    params = getCropAndScaleParameters();
    console.log(`Crop and scale: {left=${params.originLeft}, top=${params.originTop}, scaledWidth=${params.scaledWidth}, scaledHeight=${params.scaledHeight}}`);
    console.log(`Update rate: ${rate.value} fps`);
    // canvas.style.opacity = 0;
    context2d = canvas.getContext('2d');
    // This is expected to cause bilinear filtering to be used.
    console.log(`imageSmoothingQuality=${quality.value}`);
    context2d.imageSmoothingQuality = quality.value;
    canvas.width = localVideo.videoWidth;
    canvas.height = localVideo.videoHeight;
    intervalId = startCropAndScaleTimer();
    drawButton.disabled = true;
    captureButton.disabled = false;
  } catch (e) {
    loge(e);
  }
};

// TODO(henrika)
crop.onchange = () => {
  if (crop.checked) {
    params = getCropAndScaleParameters();
    console.log(`Crop and scale: {left=${params.originLeft}, top=${params.originTop}, scaledWidth=${params.scaledWidth}, scaledHeight=${params.scaledHeight}}`);
  }
};

rateSelector.onchange = () => {
  console.log(`Crop/Capture rate=${rate.value} fps`);
  if (context2d) {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = startCropAndScaleTimer();
    }
  }
};

qualitySelector.onchange = () => {
  if (context2d) {
    console.log(`imageSmoothingQuality=${quality.value}`);
    context2d.imageSmoothingQuality = quality.value;
  }
};

captureButton.onclick = () => {
  if (context2d) {
    try {
      canvasStream = canvas.captureStream(0);
      remoteVideo.srcObject = canvasStream;
      console.log(canvasStream.getVideoTracks());
      captureButton.disabled = true;
    } catch (e) {
      loge(e);
    }
  }
};

stopButton.onclick = () => {
  if (intervalId) {
    clearInterval(intervalId);
  }
  if (stream) {
    for (const track of stream.getVideoTracks()) {
      track.stop();
    }
    stream = null;
  }
  if (context2d) {
    context2d.clearRect(0, 0, canvas.width, canvas.height);
  }
  if (canvasStream) {
    for (const track of canvasStream.getVideoTracks()) {
      track.stop();
    }
    canvasStream = null;
  }
  gumButton.disabled = false;
  resolutionSelector.disabled = false;
  drawButton.disabled = true;
  captureButton.disabled = true;
  stopButton.disabled = true;
};
